import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  requestOtpRequestSchema,
  telegramWebAppLoginRequestSchema,
  verifyOtpRequestSchema,
  type RequestOtpResponse,
  type RiderSession,
  type TelegramLoginPollResponse,
  type TelegramLoginStartResponse,
  type User,
} from '@scoot/shared';
import { devFeaturesEnabled, env, otpTestPhones } from '../env.js';
import {
  NotImplementedError,
  badRequest,
  forbidden,
  notFound,
  tooManyRequests,
  unauthorized,
} from '../lib/errors.js';
import { issueToken } from '../lib/jwt.js';
import { logInfo } from '../lib/logger.js';
import { hashSecret, verifySecret } from '../lib/password.js';
import { generateNonce, verifyInitData } from '../lib/telegram.js';
import { repositories } from '../repositories/index.js';
import type { AppEnv } from '../middleware/auth.js';

/** Rider phone authentication. */
export const authRoutes = new Hono<AppEnv>();

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_S = 60;
const OTP_MAX_ATTEMPTS = 5;

function generateCode(): string {
  // Dev keeps a fixed code so the demo never waits on an SMS provider.
  if (devFeaturesEnabled) return env.DEV_OTP_CODE;
  const value = Math.floor(Math.random() * 1_000_000);
  return value.toString().padStart(6, '0');
}

/**
 * With OTP_TEST_PHONES set, sign-in is limited to those numbers — test builds
 * circulate before the SMS provider exists, and an open any-number login on a
 * fixed code would let anyone in. Checked on both request and verify.
 */
function assertPhoneAllowed(phone: string): void {
  if (otpTestPhones.length > 0 && !otpTestPhones.includes(phone)) {
    throw forbidden('Sign-in on this build is limited to the test account');
  }
}

authRoutes.post('/otp/request', zValidator('json', requestOtpRequestSchema), async (c) => {
  const { phone } = c.req.valid('json');
  assertPhoneAllowed(phone);

  const lastIssued = await repositories.otp.lastIssuedAt(phone);
  if (lastIssued !== null) {
    const elapsedS = Math.floor((Date.now() - lastIssued.getTime()) / 1000);
    if (elapsedS < OTP_RESEND_COOLDOWN_S) {
      throw tooManyRequests('A code was already sent — wait before requesting another', {
        retryAfterS: OTP_RESEND_COOLDOWN_S - elapsedS,
      });
    }
  }

  const code = generateCode();
  await repositories.otp.create({
    phone,
    codeHash: await hashSecret(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  // STUB (outside the demo path): production would hand the code to an SMS
  // provider here. Development returns it in the response instead.
  if (devFeaturesEnabled) {
    logInfo(`OTP for ${phone}: ${code}`);
  }

  const body: RequestOtpResponse = {
    retryAfterS: OTP_RESEND_COOLDOWN_S,
    ...(devFeaturesEnabled ? { devCode: code } : {}),
  };
  return c.json(body);
});

authRoutes.post('/otp/verify', zValidator('json', verifyOtpRequestSchema), async (c) => {
  const { phone, code } = c.req.valid('json');
  assertPhoneAllowed(phone);

  // Development accepts the fixed code even with no pending row, so a restart
  // mid-demo can never lock the phone out.
  const acceptedByDevCode = devFeaturesEnabled && code === env.DEV_OTP_CODE;

  if (!acceptedByDevCode) {
    const pending = await repositories.otp.findActive(phone);
    if (pending === null) {
      throw unauthorized('No active code for this number — request a new one');
    }
    if (pending.attempts >= OTP_MAX_ATTEMPTS) {
      throw tooManyRequests('Too many incorrect attempts — request a new code');
    }
    const matches = await verifySecret(code, pending.codeHash);
    if (!matches) {
      await repositories.otp.recordFailedAttempt(pending.id, pending.attempts + 1);
      throw unauthorized('Incorrect code');
    }
    await repositories.otp.consume(pending.id);
  }

  const user = await repositories.users.findOrCreateByPhone(phone);
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

async function riderSession(user: User): Promise<RiderSession> {
  if (user.status === 'blocked') {
    throw badRequest('This account is blocked');
  }
  return { token: await issueToken(user.id, 'rider'), user };
}

/**
 * Mini App login: Telegram already authenticated the user — we only verify
 * that initData really came from our bot. Deliberately bypasses the
 * OTP_TEST_PHONES allowlist, which exists because a fixed OTP code is
 * guessable; a forged initData is not.
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

/** Step 2: the app polls until the bot's webhook has completed the nonce. */
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
