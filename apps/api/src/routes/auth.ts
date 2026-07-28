import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  requestOtpRequestSchema,
  verifyOtpRequestSchema,
  type RequestOtpResponse,
  type RiderSession,
} from '@scoot/shared';
import { devFeaturesEnabled, env, otpTestPhones } from '../env.js';
import { badRequest, forbidden, tooManyRequests, unauthorized } from '../lib/errors.js';
import { issueToken } from '../lib/jwt.js';
import { logInfo } from '../lib/logger.js';
import { hashSecret, verifySecret } from '../lib/password.js';
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
  if (user.status === 'blocked') {
    throw badRequest('This account is blocked');
  }

  const body: RiderSession = {
    token: await issueToken(user.id, 'rider'),
    user,
  };
  return c.json(body);
});
