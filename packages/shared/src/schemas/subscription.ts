import { z } from 'zod';
import { idSchema, timestampSchema } from './common.js';
import { planSchema } from './plan.js';
import { vehicleSchema } from './vehicle.js';

export const subscriptionStatusSchema = z.enum(['active', 'expired', 'cancelled']);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

/**
 * A subscription binds one user to one specific vehicle for a fixed window.
 * While it is active the vehicle is reserved for that rider and disappears
 * from the public map.
 */
export const subscriptionSchema = z.object({
  id: idSchema,
  userId: idSchema,
  vehicleId: idSchema,
  planId: idSchema,
  startsAt: timestampSchema,
  expiresAt: timestampSchema,
  status: subscriptionStatusSchema,
});
export type Subscription = z.infer<typeof subscriptionSchema>;

/** Row shape for the admin subscriptions table and the rider's own list. */
export const subscriptionDetailSchema = subscriptionSchema.extend({
  plan: planSchema,
  vehicle: vehicleSchema.pick({ id: true, qrCode: true, model: true, status: true }),
  userPhone: z.string(),
});
export type SubscriptionDetail = z.infer<typeof subscriptionDetailSchema>;

export const createSubscriptionRequestSchema = z.object({
  planId: idSchema,
  vehicleId: idSchema,
});
export type CreateSubscriptionRequest = z.infer<typeof createSubscriptionRequestSchema>;
