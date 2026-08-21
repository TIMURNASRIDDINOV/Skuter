import { z } from 'zod';
import { idSchema, timestampSchema, tiyinSchema } from './common.js';

export const userStatusSchema = z.enum(['active', 'blocked']);
export type UserStatus = z.infer<typeof userStatusSchema>;

/**
 * Uzbek mobile numbers in E.164: +998 followed by 9 digits.
 * Stored normalised, so `+998901234567` is the only accepted form.
 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+998\d{9}$/, 'Phone must be an Uzbek number in E.164 form, e.g. +998901234567');
export type Phone = z.infer<typeof phoneSchema>;

export const userSchema = z.object({
  id: idSchema,
  /**
   * Null for accounts created through Telegram or Google login. Riders link a
   * phone before their first ride — a scooter on the street needs a reachable
   * number — so this is null only between sign-up and that step.
   */
  phone: phoneSchema.nullable(),
  name: z.string().nullable(),
  /** Telegram account id for users who signed in via the bot / mini app. */
  telegramId: z.int().nullable(),
  /** Google account email, for users who signed in with Google. */
  email: z.email().nullable(),
  status: userStatusSchema,
  /** Wallet balance in tiyin. */
  balance: tiyinSchema,
  createdAt: timestampSchema,
});
export type User = z.infer<typeof userSchema>;

/** What a rider sees about themselves. */
export const userProfileSchema = userSchema.pick({
  id: true,
  phone: true,
  name: true,
  telegramId: true,
  email: true,
  status: true,
  balance: true,
  createdAt: true,
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const updateUserProfileRequestSchema = z.object({
  name: z.string().trim().min(1).max(80).nullable(),
});
export type UpdateUserProfileRequest = z.infer<typeof updateUserProfileRequestSchema>;
