import { Hono } from 'hono';
import { env } from '../env.js';
import { logWarn } from '../lib/logger.js';
import { parseStartCommand, sendTelegramMessage } from '../lib/telegram.js';
import { repositories } from '../repositories/index.js';

/**
 * Receiver for Telegram bot updates (one-time setup: setWebhook with a
 * secret_token). Its only job is completing native-app login nonces when a
 * user taps Start on a t.me/<bot>?start=<nonce> deep link. Always answers
 * 200 quickly — Telegram retries anything else with backoff.
 */
export const telegramWebhookRoutes = new Hono();

telegramWebhookRoutes.post('/webhook', async (c) => {
  if (
    env.TELEGRAM_WEBHOOK_SECRET === undefined ||
    c.req.header('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET
  ) {
    return c.json({ ok: false }, 401);
  }

  const update: unknown = await c.req.json().catch(() => null);
  const start = parseStartCommand(update);
  if (start === null) return c.json({ ok: true });

  const pending = await repositories.telegramNonces.findActive(start.nonce);
  if (pending === null || pending.completedAt !== null) return c.json({ ok: true });

  const user = await repositories.users.findOrCreateByTelegram(
    start.identity.telegramId,
    start.identity.name,
  );
  await repositories.telegramNonces.complete(pending.id, {
    userId: user.id,
    telegramId: start.identity.telegramId,
  });

  if (env.TELEGRAM_BOT_TOKEN !== undefined) {
    const confirmation = sendTelegramMessage(
      env.TELEGRAM_BOT_TOKEN,
      start.chatId,
      'Готово! Вернитесь в приложение Scoot — вход выполнен.',
    ).catch((error: unknown) => logWarn(`Telegram confirmation failed: ${String(error)}`));
    try {
      // Workers cancel dangling promises after the response; keep it alive.
      c.executionCtx.waitUntil(confirmation);
    } catch {
      // Node has no executionCtx — the floating promise is fine there.
    }
  }

  return c.json({ ok: true });
});
