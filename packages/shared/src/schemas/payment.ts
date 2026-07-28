import { z } from 'zod';
import { idSchema, timestampSchema, tiyinSchema } from './common.js';

export const paymentStatusSchema = z.enum(['pending', 'succeeded', 'failed', 'refunded']);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

/**
 * Provider identifier. `mock` always succeeds and is the only implementation
 * in this demo; the others are named so the column and the `PaymentProvider`
 * interface do not need changing when a real gateway is wired in.
 */
export const paymentProviderSchema = z.enum(['mock', 'payme', 'click', 'uzum']);
export type PaymentProviderName = z.infer<typeof paymentProviderSchema>;

export const paymentSchema = z.object({
  id: idSchema,
  userId: idSchema,
  rideId: idSchema.nullable(),
  subscriptionId: idSchema.nullable(),
  /** Charged amount in tiyin. */
  amount: tiyinSchema,
  provider: paymentProviderSchema,
  /** Reference returned by the provider; the mock generates a synthetic one. */
  providerRef: z.string().nullable(),
  status: paymentStatusSchema,
  createdAt: timestampSchema,
});
export type Payment = z.infer<typeof paymentSchema>;

/** What a `PaymentProvider` implementation returns from `charge`. */
export const chargeResultSchema = z.object({
  ok: z.boolean(),
  providerRef: z.string().nullable(),
  status: paymentStatusSchema,
  failureReason: z.string().nullable(),
});
export type ChargeResult = z.infer<typeof chargeResultSchema>;
