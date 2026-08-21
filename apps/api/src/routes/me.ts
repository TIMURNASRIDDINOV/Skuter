import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  API_ERROR_CODES,
  requestOtpRequestSchema,
  updateUserProfileRequestSchema,
  verifyOtpRequestSchema,
  type TelegramLoginStartResponse,
  type UserProfile,
} from '@scoot/shared';
import { env } from '../env.js';
import { NotImplementedError, conflict, notFound } from '../lib/errors.js';
import { generateNonce } from '../lib/telegram.js';
import { repositories } from '../repositories/index.js';
import { issueOtp, verifyOtp } from '../services/otp.js';
import { requireRider, riderIdOf, type AppEnv } from '../middleware/auth.js';

/** Kept in step with routes/auth.ts — both create the same kind of nonce. */
const TELEGRAM_NONCE_TTL_MS = 5 * 60 * 1000;
const TELEGRAM_POLL_INTERVAL_MS = 2000;

/** The signed-in rider's own profile. */
export const meRoutes = new Hono<AppEnv>();

meRoutes.get('/', requireRider, async (c) => {
  const user = await repositories.users.findById(riderIdOf(c.get('auth')));
  if (user === null) throw notFound('Account no longer exists');
  return c.json(user satisfies UserProfile);
});

meRoutes.patch('/', requireRider, zValidator('json', updateUserProfileRequestSchema), async (c) => {
  const { name } = c.req.valid('json');
  const user = await repositories.users.updateName(riderIdOf(c.get('auth')), name);
  if (user === null) throw notFound('Account no longer exists');
  return c.json(user satisfies UserProfile);
});

// --- Linking a phone -------------------------------------------------------

/**
 * Accounts created through Google or Telegram arrive without a phone. These
 * two endpoints attach one, using the same codes, gateway and rate limits as
 * signing in — `services/otp.ts` is the single implementation, so a linked
 * number is verified exactly as strictly as one used to sign in.
 */
meRoutes.post(
  '/phone/request',
  requireRider,
  zValidator('json', requestOtpRequestSchema),
  async (c) => {
    const { phone } = c.req.valid('json');

    // Fail before spending an SMS on a number that cannot be linked anyway.
    const owner = await repositories.users.findByPhone(phone);
    if (owner !== null && owner.id !== riderIdOf(c.get('auth'))) {
      throw conflict(API_ERROR_CODES.CONFLICT, 'That number already belongs to another account');
    }

    return c.json(await issueOtp(repositories, { phone, ip: clientIp(c.req.raw) }));
  },
);

meRoutes.post('/phone/verify', requireRider, zValidator('json', verifyOtpRequestSchema), async (c) => {
  const { phone, code } = c.req.valid('json');
  await verifyOtp(repositories, { phone, code });

  const user = await repositories.users.linkPhone(riderIdOf(c.get('auth')), phone);
  if (user === null) {
    // Either the account vanished mid-flow, or somebody linked the number
    // between the request and the verify.
    throw conflict(API_ERROR_CODES.CONFLICT, 'That number already belongs to another account');
  }
  return c.json(user satisfies UserProfile);
});

/**
 * Linking a number through Telegram instead of SMS. Same mechanism as
 * `/auth/telegram/start`, but the nonce is created against the account that is
 * already signed in, so the number Telegram vouches for lands on *this* rider
 * rather than on whichever account their Telegram identity maps to.
 *
 * The app polls `/auth/telegram/poll` exactly as it does for login; the
 * difference is only which account the phone ends up on.
 */
meRoutes.post('/phone/telegram/start', requireRider, async (c) => {
  if (env.TELEGRAM_BOT_TOKEN === undefined) {
    throw new NotImplementedError('Telegram is not configured on this server');
  }

  const nonce = generateNonce();
  await repositories.telegramNonces.create({
    nonce,
    purpose: 'link',
    userId: riderIdOf(c.get('auth')),
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

/** See the note in routes/auth.ts — Workers puts the real client here. */
function clientIp(request: Request): string | null {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for');
}
