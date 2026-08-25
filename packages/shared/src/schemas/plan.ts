import { z } from 'zod';
import { planKindSchema } from '../pricing.js';
import { idSchema, tiyinSchema } from './common.js';

export { planKindSchema };
export type { PlanKind } from '../pricing.js';

/** Minutes in a day. Rental lengths are stored in minutes; days are display. */
export const MINUTES_PER_DAY = 1440 as const;

/** Length in minutes of the rentals the app sells and the office grants. */
export const RENTAL_DURATIONS = {
  threeHours: 180,
  fiveHours: 300,
  day: MINUTES_PER_DAY,
  week: 7 * MINUTES_PER_DAY,
} as const;

/** A year, the longest rental anybody may be granted. */
export const MAX_RENTAL_MINUTES = 365 * MINUTES_PER_DAY;

export const planSchema = z.object({
  id: idSchema,
  kind: planKindSchema,
  name: z.string(),
  /** One-off unlock fee in tiyin. Zero for rental plans. */
  unlockFee: tiyinSchema.nonnegative(),
  /**
   * Per-minute rate in tiyin for `per_minute`; total plan price for `rental`.
   * See `calculateRideCost`.
   */
  price: tiyinSchema.nonnegative(),
  /**
   * How long the rental lasts, in minutes. Null for `per_minute`.
   *
   * Minutes rather than days because the app sells three- and five-hour
   * rentals; a week is simply 10 080 of them.
   */
  durationMinutes: z.int().positive().nullable(),
  /**
   * True for rentals arranged at a desk rather than sold in the app.
   *
   * `GET /catalog/plans` drops these, which is the one filter that keeps a
   * week-long agreement out of the tariff picker, the vehicle sheet and
   * Аренда without a single client-side special case. It replaces the old
   * `kind === 'weekly'` test — length and where you buy it are different
   * questions, and only one of them belongs to the rider.
   */
  officeOnly: z.boolean(),
  /**
   * Whether the plan is offered at all.
   *
   * The way a tariff is retired. A plan that has ever been ridden under cannot
   * be deleted — `rides.plan_id` is `restrict`, because a receipt has to keep
   * resolving — so switching it off is what takes it out of the app and out of
   * the grant modal while leaving history intact.
   */
  active: z.boolean(),
});
export type Plan = z.infer<typeof planSchema>;

export const createPlanRequestSchema = z
  .object({
    kind: planKindSchema,
    name: z.string().trim().min(1).max(120),
    unlockFee: tiyinSchema.nonnegative(),
    price: tiyinSchema.nonnegative(),
    durationMinutes: z.int().positive().max(MAX_RENTAL_MINUTES).nullable(),
    officeOnly: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .refine((p) => (p.kind === 'per_minute') === (p.durationMinutes === null), {
    message: 'durationMinutes must be null for per_minute plans and set for rental plans',
    path: ['durationMinutes'],
  });
export type CreatePlanRequest = z.infer<typeof createPlanRequestSchema>;

export const updatePlanRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  unlockFee: tiyinSchema.nonnegative().optional(),
  price: tiyinSchema.nonnegative().optional(),
  durationMinutes: z.int().positive().max(MAX_RENTAL_MINUTES).nullable().optional(),
  officeOnly: z.boolean().optional(),
  active: z.boolean().optional(),
});
export type UpdatePlanRequest = z.infer<typeof updatePlanRequestSchema>;
