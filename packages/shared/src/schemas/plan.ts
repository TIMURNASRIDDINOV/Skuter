import { z } from 'zod';
import { planKindSchema } from '../pricing.js';
import { idSchema, tiyinSchema } from './common.js';

export { planKindSchema };
export type { PlanKind } from '../pricing.js';

export const planSchema = z.object({
  id: idSchema,
  kind: planKindSchema,
  name: z.string(),
  /** One-off unlock fee in tiyin. Zero for subscription plans. */
  unlockFee: tiyinSchema.nonnegative(),
  /**
   * Per-minute rate in tiyin for `per_minute`; total plan price for
   * `daily`/`weekly`. See `calculateRideCost`.
   */
  price: tiyinSchema.nonnegative(),
  /** Subscription length in days. Null for `per_minute`. */
  durationDays: z.int().positive().nullable(),
});
export type Plan = z.infer<typeof planSchema>;

export const createPlanRequestSchema = z
  .object({
    kind: planKindSchema,
    name: z.string().trim().min(1).max(120),
    unlockFee: tiyinSchema.nonnegative(),
    price: tiyinSchema.nonnegative(),
    durationDays: z.int().positive().nullable(),
  })
  .refine((p) => (p.kind === 'per_minute' ? p.durationDays === null : p.durationDays !== null), {
    message: 'durationDays must be null for per_minute plans and set for daily/weekly plans',
    path: ['durationDays'],
  });
export type CreatePlanRequest = z.infer<typeof createPlanRequestSchema>;

export const updatePlanRequestSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  unlockFee: tiyinSchema.nonnegative().optional(),
  price: tiyinSchema.nonnegative().optional(),
  durationDays: z.int().positive().nullable().optional(),
});
export type UpdatePlanRequest = z.infer<typeof updatePlanRequestSchema>;
