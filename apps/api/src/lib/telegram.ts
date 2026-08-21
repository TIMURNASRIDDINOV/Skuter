import { z } from 'zod';

/**
 * Telegram login primitives. WebCrypto only (`crypto`), so the
 * same code runs on Node ≥20 and Cloudflare Workers with no dependencies.
 *
 * Mini App `initData` verification follows the documented scheme:
 *   secret_key = HMAC_SHA256(key: "WebAppData", data: bot_token)
 *   hash       = hex(HMAC_SHA256(key: secret_key, data: data_check_string))
 * where data_check_string is every key=value pair except `hash`, sorted by
 * key and joined with newlines.
 */

const encoder = new TextEncoder();

/** How stale an initData payload may be before we refuse it. */
const INIT_DATA_MAX_AGE_S = 60 * 60;

const telegramUserSchema = z.object({
  id: z.int().positive(),
  first_name: z.string().default(''),
  last_name: z.string().optional(),
  username: z.string().optional(),
});

export interface TelegramIdentity {
  telegramId: number;
  /** Display name assembled from first/last name, null when absent. */
  name: string | null;
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time equality over equal-length hex strings. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a Mini App `initData` string and extract the Telegram identity.
 * Returns null on any failure — bad hash, stale auth_date, malformed user.
 */
export async function verifyInitData(
  initData: string,
  botToken: string,
): Promise<TelegramIdentity | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (hash === null || hash.length === 0) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secretKey = await hmacSha256(encoder.encode('WebAppData'), botToken);
  const expected = toHex(await hmacSha256(secretKey, dataCheckString));
  if (!timingSafeEqualHex(expected, hash.toLowerCase())) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate)) return null;
  if (Math.abs(Date.now() / 1000 - authDate) > INIT_DATA_MAX_AGE_S) return null;

  const userJson = params.get('user');
  if (userJson === null) return null;
  let userRaw: unknown;
  try {
    userRaw = JSON.parse(userJson);
  } catch {
    return null;
  }
  const user = telegramUserSchema.safeParse(userRaw);
  if (!user.success) return null;

  const name = [user.data.first_name, user.data.last_name ?? '']
    .join(' ')
    .trim();
  return { telegramId: user.data.id, name: name.length > 0 ? name : null };
}

/** 32 random bytes, base64url — the native-app login nonce. */
export function generateNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

const telegramContactSchema = z.object({
  phone_number: z.string().min(1),
  /** Absent when the shared card is not a Telegram user at all. */
  user_id: z.number().optional(),
});

const telegramUpdateSchema = z.object({
  message: z
    .object({
      text: z.string().optional(),
      chat: z.object({ id: z.number() }),
      from: telegramUserSchema.optional(),
      contact: telegramContactSchema.optional(),
    })
    .optional(),
});

export interface StartCommand {
  nonce: string;
  chatId: number;
  identity: TelegramIdentity;
}

/**
 * Extract `/start <nonce>` from a webhook update. Returns null for anything
 * else — other messages, edited posts, junk — which the webhook ignores.
 */
export function parseStartCommand(update: unknown): StartCommand | null {
  const parsed = telegramUpdateSchema.safeParse(update);
  if (!parsed.success) return null;
  const message = parsed.data.message;
  if (message?.text === undefined || message.from === undefined) return null;

  const match = message.text.match(/^\/start[ =]([A-Za-z0-9_-]{16,})$/);
  if (match === null || match[1] === undefined) return null;

  const name = [message.from.first_name, message.from.last_name ?? ''].join(' ').trim();
  return {
    nonce: match[1],
    chatId: message.chat.id,
    identity: { telegramId: message.from.id, name: name.length > 0 ? name : null },
  };
}

/**
 * Outcome of a `contact` message. The failures are distinguished rather than
 * collapsed to null because the bot has to say something useful about each,
 * and "share your own number" is actively wrong advice for someone whose
 * Telegram is simply on a foreign number.
 */
export type SharedContactResult =
  | { kind: 'shared'; chatId: number; telegramId: number; phone: string }
  /** A forwarded third-party contact card. */
  | { kind: 'notOwn'; chatId: number }
  /** Their own number, but not `+998`. */
  | { kind: 'unsupportedCountry'; chatId: number };

/**
 * Extract a shared phone number from a webhook update. Returns null when the
 * update is not a contact message at all.
 *
 * **The `user_id === from.id` check is the whole security of this flow.**
 * Telegram's attachment menu lets anyone forward a *third party's* contact
 * card, which arrives as the same `contact` message shape. Only a card whose
 * `user_id` matches the sender is that sender's own verified number; without
 * this check a rider could register somebody else's phone.
 */
export function parseSharedContact(update: unknown): SharedContactResult | null {
  const parsed = telegramUpdateSchema.safeParse(update);
  if (!parsed.success) return null;
  const message = parsed.data.message;
  if (message?.contact === undefined || message.from === undefined) return null;

  const chatId = message.chat.id;
  const { phone_number: rawPhone, user_id: contactUserId } = message.contact;
  if (contactUserId === undefined || contactUserId !== message.from.id) {
    return { kind: 'notOwn', chatId };
  }

  const phone = normalisePhone(rawPhone);
  if (phone === null) return { kind: 'unsupportedCountry', chatId };

  return { kind: 'shared', chatId, telegramId: message.from.id, phone };
}

/**
 * Telegram reports numbers inconsistently — `998901234567`, `+998901234567`,
 * sometimes with spaces. Normalise to the `+998XXXXXXXXX` form `phoneSchema`
 * accepts, or null if this is not an Uzbek mobile number.
 *
 * A foreign number is a deliberate null rather than a stored value: the whole
 * product is Tashkent-only and `phoneSchema` is `+998`-only, so accepting one
 * here would just push the failure somewhere less explainable.
 */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const withCountry = digits.startsWith('998') ? digits : `998${digits}`;
  return /^998\d{9}$/.test(withCountry) ? `+${withCountry}` : null;
}

/**
 * Ask the user to share their own number. `request_contact` renders a button
 * that sends their verified contact — the one Telegram checked at signup — so
 * there is no code to type and no SMS to pay for.
 */
export async function requestContact(
  botToken: string,
  chatId: number,
  text: string,
  buttonLabel: string,
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: {
        keyboard: [[{ text: buttonLabel, request_contact: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    }),
  });
}

/** Fire-and-forget confirmation message; failures are the caller's to log. */
export async function sendTelegramMessage(
  botToken: string,
  chatId: number,
  text: string,
): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // remove_keyboard clears the "share my number" button once it has been
    // used; leaving it sitting there invites a second, meaningless tap.
    body: JSON.stringify({ chat_id: chatId, text, reply_markup: { remove_keyboard: true } }),
  });
}
