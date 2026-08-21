import { z } from 'zod';
import { adminSchema } from './admin.js';
import { idSchema } from './common.js';
import { phoneSchema, userProfileSchema } from './user.js';

/** Step 1 of rider auth: ask for a code. */
export const requestOtpRequestSchema = z.object({
  phone: phoneSchema,
});
export type RequestOtpRequest = z.infer<typeof requestOtpRequestSchema>;

export const requestOtpResponseSchema = z.object({
  /** Seconds until another code may be requested. */
  retryAfterS: z.int().nonnegative(),
  /**
   * Present only when the API runs in development, where a fixed code is
   * accepted so the demo never depends on an SMS provider.
   */
  devCode: z.string().optional(),
});
export type RequestOtpResponse = z.infer<typeof requestOtpResponseSchema>;

/** Step 2: exchange the code for a token. Creates the user on first login. */
export const verifyOtpRequestSchema = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^\d{6}$/, 'Code must be six digits'),
});
export type VerifyOtpRequest = z.infer<typeof verifyOtpRequestSchema>;

/**
 * Google sign-in: the ID token from the native Google sheet. The API verifies
 * its RS256 signature against Google's published keys and checks the audience,
 * so a forged token is not accepted — no OTP round-trip needed.
 */
export const googleLoginRequestSchema = z.object({
  idToken: z.string().min(1),
});
export type GoogleLoginRequest = z.infer<typeof googleLoginRequestSchema>;

export const riderSessionSchema = z.object({
  token: z.string(),
  user: userProfileSchema,
});
export type RiderSession = z.infer<typeof riderSessionSchema>;

/**
 * Telegram Mini App login: the raw `window.Telegram.WebApp.initData` string.
 * The API verifies its HMAC against the bot token — no OTP round-trip.
 */
export const telegramWebAppLoginRequestSchema = z.object({
  initData: z.string().min(1),
});
export type TelegramWebAppLoginRequest = z.infer<typeof telegramWebAppLoginRequestSchema>;

/**
 * Native-app Telegram login, step 1: the app gets a one-time nonce and a
 * deep link into the bot. The user taps Start; the bot's webhook completes
 * the nonce; the app polls until it turns into a session.
 */
export const telegramLoginStartResponseSchema = z.object({
  nonce: z.string(),
  deepLink: z.url(),
  expiresInS: z.int().positive(),
  pollIntervalMs: z.int().positive(),
});
export type TelegramLoginStartResponse = z.infer<typeof telegramLoginStartResponseSchema>;

/** Step 2: poll result — pending until the bot has seen /start <nonce>. */
export const telegramLoginPollResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('complete'), token: z.string(), user: userProfileSchema }),
]);
export type TelegramLoginPollResponse = z.infer<typeof telegramLoginPollResponseSchema>;

export const adminLoginRequestSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(200),
});
export type AdminLoginRequest = z.infer<typeof adminLoginRequestSchema>;

export const adminSessionSchema = z.object({
  token: z.string(),
  admin: adminSchema,
});
export type AdminSession = z.infer<typeof adminSessionSchema>;

export const jwtRoleSchema = z.enum(['rider', 'admin']);
export type JwtRole = z.infer<typeof jwtRoleSchema>;

/**
 * JWT payload shared by both audiences. `sub` is the user or admin id; `role`
 * decides which middleware will accept the token.
 */
export const jwtClaimsSchema = z.object({
  sub: idSchema,
  role: jwtRoleSchema,
  /** Issued-at and expiry, seconds since epoch. */
  iat: z.int(),
  exp: z.int(),
});
export type JwtClaims = z.infer<typeof jwtClaimsSchema>;
