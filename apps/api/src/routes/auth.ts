import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  googleLoginRequestSchema,
  requestOtpRequestSchema,
  telegramWebAppLoginRequestSchema,
  verifyOtpRequestSchema,
  type RiderSession,
  type TelegramLoginPollResponse,
  type TelegramLoginStartResponse,
  type User,
} from '@scoot/shared';
import { env, googleClientIds } from '../env.js';
import { NotImplementedError, badRequest, notFound, unauthorized } from '../lib/errors.js';
import { verifyGoogleIdToken } from '../lib/google.js';
import { issueToken } from '../lib/jwt.js';
import { generateNonce, verifyInitData } from '../lib/telegram.js';
import { repositories } from '../repositories/index.js';
import { issueOtp, verifyOtp } from '../services/otp.js';
import type { AppEnv } from '../middleware/auth.js';

/** Rider phone authentication. */
export const authRoutes = new Hono<AppEnv>();

authRoutes.post('/otp/request', zValidator('json', requestOtpRequestSchema), async (c) => {
  const { phone } = c.req.valid('json');
  return c.json(await issueOtp(repositories, { phone, ip: clientIp(c.req.raw) }));
});

authRoutes.post('/otp/verify', zValidator('json', verifyOtpRequestSchema), async (c) => {
  const { phone, code } = c.req.valid('json');
  await verifyOtp(repositories, { phone, code });

  const user = await repositories.users.findOrCreateByPhone(phone);
  return c.json(await riderSession(user));
});

// --- Google login ----------------------------------------------------------

/**
 * The native app hands us the ID token from the Google sheet. Verification
 * lives in `lib/google.ts`; this route only turns an identity into a session.
 *
 * A Google account arrives without a phone number. That is deliberate — the
 * rider is signed in immediately, and `services/rides.ts` is where a verified
 * phone is required, at the point it actually matters.
 */
authRoutes.post('/google', zValidator('json', googleLoginRequestSchema), async (c) => {
  if (googleClientIds.length === 0) {
    throw new NotImplementedError('Google sign-in is not configured on this server');
  }

  const identity = await verifyGoogleIdToken(c.req.valid('json').idToken, googleClientIds);
  if (identity === null) {
    throw unauthorized('Google sign-in data failed verification');
  }

  const user = await repositories.users.findOrCreateByGoogle(identity);
  return c.json(await riderSession(user));
});

// --- Telegram login --------------------------------------------------------

const TELEGRAM_NONCE_TTL_MS = 5 * 60 * 1000;
const TELEGRAM_POLL_INTERVAL_MS = 2000;

/** Narrows the optional bot token; 501 when Telegram login is not set up. */
function telegramBotToken(): string {
  if (env.TELEGRAM_BOT_TOKEN === undefined) {
    throw new NotImplementedError('Telegram login is not configured on this server');
  }
  return env.TELEGRAM_BOT_TOKEN;
}

/**
 * The caller's address, for the per-IP send cap. On Workers the socket belongs
 * to Cloudflare, so the real client is in `CF-Connecting-IP`; locally there is
 * usually no such header and the cap simply does not bind.
 */
function clientIp(request: Request): string | null {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for');
}

async function riderSession(user: User): Promise<RiderSession> {
  if (user.status === 'blocked') {
    throw badRequest('This account is blocked');
  }
  return { token: await issueToken(user.id, 'rider'), user };
}

/**
 * Mini App login: Telegram already authenticated the user — we only verify
 * that initData really came from our bot. Like Google, this creates an account
 * with no phone; `services/rides.ts` is where one is required.
 */
authRoutes.post(
  '/telegram/webapp',
  zValidator('json', telegramWebAppLoginRequestSchema),
  async (c) => {
    const botToken = telegramBotToken();
    const { initData } = c.req.valid('json');

    const identity = await verifyInitData(initData, botToken);
    if (identity === null) {
      throw unauthorized('Telegram sign-in data failed verification');
    }

    const user = await repositories.users.findOrCreateByTelegram(
      identity.telegramId,
      identity.name,
    );
    return c.json(await riderSession(user));
  },
);

/** Native-app login, step 1: a nonce and a deep link into the bot. */
authRoutes.post('/telegram/start', async (c) => {
  telegramBotToken();

  const nonce = generateNonce();
  await repositories.telegramNonces.create({
    nonce,
    purpose: 'login',
    expiresAt: new Date(Date.now() + TELEGRAM_NONCE_TTL_MS),
  });

  const body: TelegramLoginStartResponse = {
    nonce,
    deepLink: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=${nonce}`,
    expiresInS: TELEGRAM_NONCE_TTL_MS / 1000,
    pollIntervalMs: TELEGRAM_POLL_INTERVAL_MS,
  };
  return c.json(body);
});

/**
 * Step 2: the app polls until the bot's webhook has completed the nonce.
 *
 * Completion now waits for the rider to share their number, not merely to tap
 * Start — see routes/telegram-webhook.ts. So a session handed out here always
 * carries a verified phone, and Telegram is a full substitute for an SMS
 * provider rather than a way in that skips one.
 */
authRoutes.get('/telegram/poll', async (c) => {
  telegramBotToken();

  const nonce = c.req.query('nonce');
  if (nonce === undefined || nonce.length === 0) {
    throw badRequest('nonce is required');
  }

  const pending = await repositories.telegramNonces.findActive(nonce);
  if (pending === null) {
    throw notFound('Unknown, expired or already used login attempt');
  }

  if (pending.completedAt === null || pending.userId === null) {
    const body: TelegramLoginPollResponse = { status: 'pending' };
    return c.json(body);
  }

  // Single use: consumed the moment the session is handed out.
  await repositories.telegramNonces.consume(pending.id);
  const user = await repositories.users.findById(pending.userId);
  if (user === null) {
    throw notFound('Unknown, expired or already used login attempt');
  }

  const session = await riderSession(user);
  const body: TelegramLoginPollResponse = { status: 'complete', ...session };
  return c.json(body);
});
