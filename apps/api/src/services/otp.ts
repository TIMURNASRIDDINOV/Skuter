import type { RequestOtpResponse } from '@ozothunder/shared';
import { devFeaturesEnabled, devOtpCode, otpBypassPhones } from '../env.js';
import { tooManyRequests, unauthorized } from '../lib/errors.js';
import { logError } from '../lib/logger.js';
import { hashSecret, verifySecret } from '../lib/password.js';
import type { Repositories } from '../repositories/index.js';
import { getSmsGateway } from '../sms/index.js';

/**
 * One-time codes over SMS. Used by two flows that must behave identically:
 * signing in with a phone (`routes/auth.ts`) and attaching a phone to an
 * account that signed up with Google or Telegram (`routes/me.ts`).
 *
 * Every code is a real random six digits delivered by the SMS gateway. The
 * fixed `DEV_OTP_CODE` is no longer *generated* — it is only *accepted*, and
 * only for numbers in `OTP_BYPASS_PHONES`, so a rehearsed demo never waits on
 * a carrier while everybody else gets the real thing.
 */

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_S = 60;
const OTP_MAX_ATTEMPTS = 5;

/**
 * Caps on top of the resend cooldown. The cooldown alone only slows one number
 * down; these bound what a single number or a single address can cost. Every
 * message is billed, so an uncapped endpoint is somebody else's free SMS.
 */
const MAX_PER_PHONE_PER_DAY = 5;
const MAX_PER_IP_PER_HOUR = 20;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface IssueOtpInput {
  phone: string;
  /** Caller address for the per-IP cap; null when we cannot determine one. */
  ip: string | null;
}

/**
 * Issues a code and sends it. Bypass numbers skip the SMS and get the fixed
 * code back in the response, which is what auto-fills the app's code field.
 */
export async function issueOtp(
  repositories: Repositories,
  { phone, ip }: IssueOtpInput,
): Promise<RequestOtpResponse> {
  if (bypassAllowed(phone)) {
    return { retryAfterS: OTP_RESEND_COOLDOWN_S, devCode: devOtpCode };
  }

  await assertWithinLimits(repositories, phone, ip);

  const code = generateCode();
  await repositories.otp.create({
    phone,
    codeHash: await hashSecret(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
    requestIp: ip,
  });

  // The row is written first so a code that *does* arrive is always verifiable.
  // If the send then fails, consume it and fail loudly: telling the rider a
  // code is coming when it is not would leave them staring at an empty inbox,
  // and leaving the row behind would strand them behind the resend cooldown
  // holding a code they never received.
  try {
    await getSmsGateway().send({ phone, message: smsText(code) });
  } catch (error) {
    const pending = await repositories.otp.findActive(phone);
    if (pending !== null) await repositories.otp.consume(pending.id);
    logError(`Could not send an OTP to ${phone}`, error);
    throw tooManyRequests('Could not send the code — try again in a moment');
  }

  return { retryAfterS: OTP_RESEND_COOLDOWN_S };
}

export interface VerifyOtpInput {
  phone: string;
  code: string;
}

/** Throws unless the code is valid for the phone. Consumes it on success. */
export async function verifyOtp(
  repositories: Repositories,
  { phone, code }: VerifyOtpInput,
): Promise<void> {
  // Bypass numbers accept the fixed code with no pending row at all, so a
  // restart mid-demo can never lock the phone out.
  if (bypassAllowed(phone) && code === devOtpCode) return;

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

/**
 * The text that reaches the handset. Eskiz moderates message texts and the
 * operators reject authorisation codes that do not name the service and say
 * what the code is for, so this wording is not cosmetic — changing it means
 * submitting the new text for moderation first. See docs/deploy.md.
 */
function smsText(code: string): string {
  return `Код подтверждения для входа в мобильное приложение Ozo Thunder: ${code}`;
}

function generateCode(): string {
  // `crypto.getRandomValues` rather than Math.random: this is a credential.
  const [value] = crypto.getRandomValues(new Uint32Array(1));
  return ((value ?? 0) % 1_000_000).toString().padStart(6, '0');
}

/** Whether this number may use the fixed code instead of waiting for an SMS. */
function bypassAllowed(phone: string): boolean {
  return devFeaturesEnabled && otpBypassPhones.includes(phone);
}

async function assertWithinLimits(
  repositories: Repositories,
  phone: string,
  ip: string | null,
): Promise<void> {
  const lastIssued = await repositories.otp.lastIssuedAt(phone);
  if (lastIssued !== null) {
    const elapsedS = Math.floor((Date.now() - lastIssued.getTime()) / 1000);
    if (elapsedS < OTP_RESEND_COOLDOWN_S) {
      throw tooManyRequests('A code was already sent — wait before requesting another', {
        retryAfterS: OTP_RESEND_COOLDOWN_S - elapsedS,
      });
    }
  }

  const today = await repositories.otp.countRecentByPhone(phone, new Date(Date.now() - DAY_MS));
  if (today >= MAX_PER_PHONE_PER_DAY) {
    throw tooManyRequests('Too many codes requested for this number today');
  }

  if (ip !== null) {
    const fromIp = await repositories.otp.countRecentByIp(ip, new Date(Date.now() - HOUR_MS));
    if (fromIp >= MAX_PER_IP_PER_HOUR) {
      throw tooManyRequests('Too many codes requested — try again later');
    }
  }
}
