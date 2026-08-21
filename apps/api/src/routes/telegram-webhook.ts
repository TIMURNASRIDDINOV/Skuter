import { Hono } from 'hono';
import { env } from '../env.js';
import { logWarn } from '../lib/logger.js';
import {
  parseSharedContact,
  parseStartCommand,
  requestContact,
  sendTelegramMessage,
} from '../lib/telegram.js';
import { repositories } from '../repositories/index.js';

/**
 * Receiver for Telegram bot updates (one-time setup: setWebhook with a
 * secret_token). Always answers 200 quickly — Telegram retries anything else
 * with backoff.
 *
 * It drives a two-message conversation, because the number and the tap arrive
 * separately:
 *
 *   1. `/start <nonce>` — claim the nonce, remember the chat, ask for the
 *      number with a `request_contact` button.
 *   2. the shared contact — verify it is the sender's own, attach it to the
 *      nonce, and only then complete it.
 *
 * Sharing the number is **required**: the nonce does not complete on Start
 * alone, so a Telegram rider always lands with a phone we can reach. That is
 * what makes the ride gate in services/rides.ts a formality for them.
 *
 * This is also why Ozo Thunder needs no SMS provider to verify a number — Telegram
 * already verified it, and vouches for it here.
 */
export const telegramWebhookRoutes = new Hono();

const ASK_FOR_NUMBER =
  'Осталось подтвердить номер телефона — он нужен, чтобы вы могли начать поездку.';
const SHARE_BUTTON = '📱 Поделиться номером';
const DONE = 'Готово! Вернитесь в приложение Ozo Thunder — вход выполнен.';
const WRONG_COUNTRY =
  'Ozo Thunder пока работает только с узбекскими номерами (+998). Войдите по номеру телефона в приложении.';
const NOT_YOUR_NUMBER =
  'Нужен ваш собственный номер — нажмите кнопку «Поделиться номером», а не пересылайте чужой контакт.';
const NUMBER_TAKEN = 'Этот номер уже привязан к другому аккаунту Ozo Thunder.';

telegramWebhookRoutes.post('/webhook', async (c) => {
  if (
    env.TELEGRAM_WEBHOOK_SECRET === undefined ||
    c.req.header('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET
  ) {
    return c.json({ ok: false }, 401);
  }

  const update: unknown = await c.req.json().catch(() => null);
  const botToken = env.TELEGRAM_BOT_TOKEN;

  /** Telegram cancels dangling promises on Workers; keep the reply alive. */
  const inBackground = (work: Promise<unknown>): void => {
    const guarded = work.catch((error: unknown) => logWarn(`Telegram reply failed: ${String(error)}`));
    try {
      c.executionCtx.waitUntil(guarded);
    } catch {
      // Node has no executionCtx — the floating promise is fine there.
    }
  };

  // --- leg 1: /start <nonce> ------------------------------------------------

  const start = parseStartCommand(update);
  if (start !== null) {
    const pending = await repositories.telegramNonces.findActive(start.nonce);
    if (pending === null || pending.completedAt !== null) return c.json({ ok: true });

    // Deliberately no account work here. The rider is not identified until a
    // number arrives — creating one on Start would leave an orphan behind
    // whenever the contact step is abandoned or the number turns out to
    // belong to an account they already have.
    await repositories.telegramNonces.claim(pending.id, {
      userId: null,
      telegramId: start.identity.telegramId,
      chatId: start.chatId,
      name: start.identity.name,
    });

    if (botToken !== undefined) {
      inBackground(requestContact(botToken, start.chatId, ASK_FOR_NUMBER, SHARE_BUTTON));
    }
    return c.json({ ok: true });
  }

  // --- leg 2: the shared contact -------------------------------------------

  const contact = parseSharedContact(update);
  if (contact === null) return c.json({ ok: true });

  // Both failures get an answer. Silence here reads as a broken bot, and the
  // two causes need different advice.
  if (contact.kind !== 'shared') {
    if (botToken !== undefined) {
      const reply = contact.kind === 'notOwn' ? NOT_YOUR_NUMBER : WRONG_COUNTRY;
      inBackground(sendTelegramMessage(botToken, contact.chatId, reply));
    }
    return c.json({ ok: true });
  }

  const pending = await repositories.telegramNonces.findAwaitingContact(contact.chatId);
  if (pending === null) return c.json({ ok: true });

  // `link` already knows whose account this is; `login` resolves it now, from
  // the Telegram id and the freshly-verified number together.
  const rider =
    pending.userId === null
      ? await repositories.users.findOrCreateForTelegramContact({
          telegramId: contact.telegramId,
          name: pending.name,
          phone: contact.phone,
        })
      : await repositories.users.linkPhone(pending.userId, contact.phone);

  if (rider === null) {
    // The number is already on a different account. Leaving the nonce pending
    // lets them retry from the right account rather than silently handing over
    // somebody else's ride history.
    if (botToken !== undefined) {
      inBackground(sendTelegramMessage(botToken, contact.chatId, NUMBER_TAKEN));
    }
    return c.json({ ok: true });
  }

  await repositories.telegramNonces.complete(pending.id, {
    userId: rider.id,
    phone: contact.phone,
  });

  if (botToken !== undefined) {
    inBackground(sendTelegramMessage(botToken, contact.chatId, DONE));
  }
  return c.json({ ok: true });
});
