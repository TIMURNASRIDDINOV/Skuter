import { z } from 'zod';
import { latLonSchema } from '../geo.js';
import { idSchema, timestampSchema, tiyinSchema } from './common.js';
import { commandStatusSchema, commandTypeSchema } from './command.js';
import { rideStatusSchema } from './ride.js';
import { batteryPctSchema, vehicleStatusSchema } from './vehicle.js';
import { zoneKindSchema } from './zone.js';

/**
 * Server-sent events pushed to the admin panel. Defined here so the API and
 * the admin can never disagree on the wire format.
 *
 * Consumed over SSE at `GET /admin/events` (Checkpoint 3). The panel updates
 * its tables and map from these — it does not poll.
 */

export const vehicleUpdatedEventSchema = z.object({
  type: z.literal('vehicle.updated'),
  at: timestampSchema,
  vehicleId: idSchema,
  status: vehicleStatusSchema,
  batteryPct: batteryPctSchema,
  location: latLonSchema,
});

export const rideStartedEventSchema = z.object({
  type: z.literal('ride.started'),
  at: timestampSchema,
  rideId: idSchema,
  userId: idSchema,
  vehicleId: idSchema,
});

export const rideUpdatedEventSchema = z.object({
  type: z.literal('ride.updated'),
  at: timestampSchema,
  rideId: idSchema,
  distanceM: z.int().nonnegative(),
  durationS: z.int().nonnegative(),
  currentCost: tiyinSchema.nonnegative(),
  location: latLonSchema,
});

export const rideEndedEventSchema = z.object({
  type: z.literal('ride.ended'),
  at: timestampSchema,
  rideId: idSchema,
  userId: idSchema,
  vehicleId: idSchema,
  status: rideStatusSchema,
  cost: tiyinSchema.nonnegative(),
  distanceM: z.int().nonnegative(),
  durationS: z.int().nonnegative(),
});

export const commandUpdatedEventSchema = z.object({
  type: z.literal('command.updated'),
  at: timestampSchema,
  commandId: idSchema,
  vehicleId: idSchema,
  commandType: commandTypeSchema,
  status: commandStatusSchema,
});

export const subscriptionCreatedEventSchema = z.object({
  type: z.literal('subscription.created'),
  at: timestampSchema,
  subscriptionId: idSchema,
  userId: idSchema,
  vehicleId: idSchema,
  expiresAt: timestampSchema,
});

/**
 * A subscription window closed — cancelled by an operator or simply lapsed.
 * The panel refreshes its table off this, and the vehicle it frees arrives
 * separately as a `vehicle.updated`.
 */
export const subscriptionEndedEventSchema = z.object({
  type: z.literal('subscription.ended'),
  at: timestampSchema,
  subscriptionId: idSchema,
  userId: idSchema,
  vehicleId: idSchema,
  reason: z.enum(['expired', 'cancelled']),
});

export const zoneChangedEventSchema = z.object({
  type: z.literal('zone.changed'),
  at: timestampSchema,
  zoneId: idSchema,
  kind: zoneKindSchema,
  action: z.enum(['created', 'updated', 'deleted']),
});

/** Keeps intermediaries from closing an idle SSE connection. */
export const heartbeatEventSchema = z.object({
  type: z.literal('heartbeat'),
  at: timestampSchema,
});

export const serverEventSchema = z.discriminatedUnion('type', [
  vehicleUpdatedEventSchema,
  rideStartedEventSchema,
  rideUpdatedEventSchema,
  rideEndedEventSchema,
  commandUpdatedEventSchema,
  subscriptionCreatedEventSchema,
  subscriptionEndedEventSchema,
  zoneChangedEventSchema,
  heartbeatEventSchema,
]);
export type ServerEvent = z.infer<typeof serverEventSchema>;
export type ServerEventType = ServerEvent['type'];
