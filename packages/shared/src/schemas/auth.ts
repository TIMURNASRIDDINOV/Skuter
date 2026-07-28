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

export const riderSessionSchema = z.object({
  token: z.string(),
  user: userProfileSchema,
});
export type RiderSession = z.infer<typeof riderSessionSchema>;

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
