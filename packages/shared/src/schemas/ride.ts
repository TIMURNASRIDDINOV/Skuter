import { z } from 'zod';
import { geoLineStringSchema, latLonSchema } from '../geo.js';
import { idSchema, timestampSchema, tiyinSchema } from './common.js';
import { parkingCheckSchema } from './zone.js';

export const rideStatusSchema = z.enum(['active', 'completed', 'cancelled']);
export type RideStatus = z.infer<typeof rideStatusSchema>;

export const rideSchema = z.object({
  id: idSchema,
  userId: idSchema,
  vehicleId: idSchema,
  startedAt: timestampSchema,
  endedAt: timestampSchema.nullable(),
  /** Travelled path. Null until the ride has moved at least two points. */
  path: geoLineStringSchema.nullable(),
  distanceM: z.int().nonnegative(),
  durationS: z.int().nonnegative(),
  /** Total charged in tiyin. Zero while the ride is still active. */
  cost: tiyinSchema.nonnegative(),
  endZoneId: idSchema.nullable(),
  status: rideStatusSchema,
});
export type Ride = z.infer<typeof rideSchema>;

/** The live ride the app polls/streams while riding. */
export const activeRideSchema = rideSchema.extend({
  vehicle: z.object({
    id: idSchema,
    qrCode: z.string(),
    model: z.string(),
    batteryPct: z.int().min(0).max(100),
    location: latLonSchema,
  }),
  planId: idSchema,
  /** Cost accrued so far, recomputed from the same shared pricing function. */
  currentCost: tiyinSchema.nonnegative(),
});
export type ActiveRide = z.infer<typeof activeRideSchema>;

/** Line items shown on the receipt after a ride ends. */
export const rideCostBreakdownSchema = z.object({
  unlockFee: tiyinSchema.nonnegative(),
  ratePerMinute: tiyinSchema.nonnegative(),
  chargedMinutes: z.int().nonnegative(),
  timeFee: tiyinSchema.nonnegative(),
  total: tiyinSchema.nonnegative(),
  durationS: z.number().nonnegative(),
  distanceM: z.number().nonnegative(),
  coveredBySubscription: z.boolean(),
});
export type RideCostBreakdownPayload = z.infer<typeof rideCostBreakdownSchema>;

export const rideReceiptSchema = z.object({
  ride: rideSchema,
  breakdown: rideCostBreakdownSchema,
  planName: z.string(),
  endZoneName: z.string().nullable(),
});
export type RideReceipt = z.infer<typeof rideReceiptSchema>;

export const startRideRequestSchema = z.object({
  /** Scanned from the sticker, or typed via the dev "simulate scan" button. */
  qrCode: z.string().trim().toUpperCase(),
  planId: idSchema,
});
export type StartRideRequest = z.infer<typeof startRideRequestSchema>;

export const endRideRequestSchema = z.object({
  /** Where the rider says they are parking. Validated against PostGIS zones. */
  location: latLonSchema,
});
export type EndRideRequest = z.infer<typeof endRideRequestSchema>;

/**
 * Returned by both the pre-flight parking check and a rejected end-ride, so
 * the app renders the same "walk to nearest parking" screen in both cases.
 */
export const endRideRejectionSchema = z.object({
  check: parkingCheckSchema,
});
export type EndRideRejection = z.infer<typeof endRideRejectionSchema>;

export const listRidesQuerySchema = z.object({
  status: rideStatusSchema.optional(),
  userId: idSchema.optional(),
  vehicleId: idSchema.optional(),
});
export type ListRidesQuery = z.infer<typeof listRidesQuerySchema>;
