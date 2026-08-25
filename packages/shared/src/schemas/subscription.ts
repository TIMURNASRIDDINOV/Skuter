import { z } from 'zod';
import { idSchema, timestampSchema } from './common.js';
import { MAX_RENTAL_MINUTES, planSchema } from './plan.js';
import { vehicleSchema } from './vehicle.js';

export const subscriptionStatusSchema = z.enum(['active', 'expired', 'cancelled']);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

/**
 * A subscription binds one user to one specific vehicle for a fixed window.
 * While it is active the vehicle is reserved for that rider and disappears
 * from the public map.
 *
 * Rentals reach this table by two doors. Short ones — three hours, five, a
 * day — are bought in the app. Long ones are agreements signed at the office:
 * the rider pays at the desk and an operator grants it from the back office.
 * Which door a plan uses is `plan.officeOnly`, not its length; see
 * `grantSubscriptionRequestSchema`.
 */
export const subscriptionSchema = z.object({
  id: idSchema,
  userId: idSchema,
  vehicleId: idSchema,
  planId: idSchema,
  startsAt: timestampSchema,
  expiresAt: timestampSchema,
  status: subscriptionStatusSchema,
  /**
   * When the rider last switched the scooter on, or null while it is locked.
   *
   * The lock state of a rental lives here rather than on the vehicle:
   * turning it on is a gateway command, not a ride, so the vehicle stays
   * `reserved` for the whole window and nothing else needs a new status.
   */
  unlockedAt: timestampSchema.nullable(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

/** Row shape for the admin subscriptions table and the rider's own list. */
export const subscriptionDetailSchema = subscriptionSchema.extend({
  plan: planSchema,
  vehicle: vehicleSchema.pick({ id: true, qrCode: true, model: true, status: true }),
  /** Null when the subscriber signed up via Telegram and has no phone. */
  userPhone: z.string().nullable(),
  /** Null until the rider fills one in. The office looks people up by both. */
  userName: z.string().nullable(),
});
export type SubscriptionDetail = z.infer<typeof subscriptionDetailSchema>;

export const createSubscriptionRequestSchema = z.object({
  planId: idSchema,
  vehicleId: idSchema,
});
export type CreateSubscriptionRequest = z.infer<typeof createSubscriptionRequestSchema>;

/**
 * What an operator sends to turn rent on for a rider who has already paid at
 * the office. Office-only plans have no in-app equivalent by design — that
 * agreement is made with a person at a desk, not with a payment sheet.
 */
export const grantSubscriptionRequestSchema = z.object({
  userId: idSchema,
  vehicleId: idSchema,
  planId: idSchema,
  /**
   * Overrides the plan's own length, in minutes. Lets the office sell two
   * weeks on the weekly plan without inventing a second plan row; null takes
   * the plan's own duration.
   */
  durationMinutes: z.int().positive().max(MAX_RENTAL_MINUTES).nullable().optional(),
});
export type GrantSubscriptionRequest = z.infer<typeof grantSubscriptionRequestSchema>;

/**
 * Everything the rider's rental console shows, in one payload.
 *
 * Whether the scooter is on is *derived* from `subscription.unlockedAt`, never
 * carried alongside it — one fact, one field. Every active rental gets this
 * screen now, whether it runs for three hours or a fortnight.
 */
export const rentalSchema = z.object({
  subscription: subscriptionSchema,
  plan: planSchema,
  vehicle: vehicleSchema.pick({
    id: true,
    qrCode: true,
    model: true,
    status: true,
    batteryPct: true,
    rangeM: true,
    location: true,
  }),
});
export type Rental = z.infer<typeof rentalSchema>;
