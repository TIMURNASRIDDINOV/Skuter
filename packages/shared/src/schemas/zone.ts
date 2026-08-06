import { z } from 'zod';
import { geoPolygonSchema } from '../geo.js';
import { idSchema } from './common.js';

/**
 * `service`   — riders may ride here at all; leaving it is blocked.
 * `parking`   — a ride may only be ended inside one of these.
 * `forbidden` — riding and parking are both refused here.
 * `slow`      — riding is allowed but capped at `speedLimitKph`.
 *
 * `slow` is the only kind that does not change what a rider is *allowed* to
 * do, which is why it is inert in `checkParking` — the parking rules query
 * the other three kinds by name.
 */
export const zoneKindSchema = z.enum(['service', 'parking', 'forbidden', 'slow']);
export type ZoneKind = z.infer<typeof zoneKindSchema>;

/** Speed cap applied inside a `slow` zone, km/h. */
export const speedLimitKphSchema = z.int().positive().max(60);

export const zoneSchema = z.object({
  id: idSchema,
  name: z.string(),
  kind: zoneKindSchema,
  geom: geoPolygonSchema,
  areaId: idSchema.nullable(),
  /** Set on `slow` zones, null on every other kind. */
  speedLimitKph: speedLimitKphSchema.nullable(),
});
export type Zone = z.infer<typeof zoneSchema>;

export const areaSchema = z.object({
  id: idSchema,
  name: z.string(),
  geom: geoPolygonSchema,
});
export type Area = z.infer<typeof areaSchema>;

export const listZonesQuerySchema = z.object({
  kind: zoneKindSchema.optional(),
  areaId: idSchema.optional(),
});
export type ListZonesQuery = z.infer<typeof listZonesQuerySchema>;

/**
 * A speed limit only means something on a `slow` zone. Rejecting the
 * combination here rather than quietly dropping it keeps the back office
 * honest: a limit typed into a parking zone is a mistake worth reporting, not
 * a value to swallow.
 */
const speedLimitMatchesKind = {
  check: (zone: { kind?: ZoneKind; speedLimitKph?: number | null }) =>
    zone.kind === 'slow'
      ? zone.speedLimitKph !== null && zone.speedLimitKph !== undefined
      : zone.speedLimitKph === null || zone.speedLimitKph === undefined,
  message: 'speedLimitKph is required for slow zones and must be null on every other kind',
  path: ['speedLimitKph'] as const,
};

export const createZoneRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: zoneKindSchema,
    geom: geoPolygonSchema,
    areaId: idSchema.nullable().optional(),
    speedLimitKph: speedLimitKphSchema.nullable().optional(),
  })
  .refine(speedLimitMatchesKind.check, {
    message: speedLimitMatchesKind.message,
    path: [...speedLimitMatchesKind.path],
  });
export type CreateZoneRequest = z.infer<typeof createZoneRequestSchema>;

/**
 * Partial, so a rename need not resend the geometry. The kind/limit pairing is
 * only enforced when `kind` is part of the patch — validating it against an
 * absent kind would reject every rename of an existing slow zone.
 */
export const updateZoneRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    kind: zoneKindSchema.optional(),
    geom: geoPolygonSchema.optional(),
    areaId: idSchema.nullable().optional(),
    speedLimitKph: speedLimitKphSchema.nullable().optional(),
  })
  .refine((zone) => zone.kind === undefined || speedLimitMatchesKind.check(zone), {
    message: speedLimitMatchesKind.message,
    path: [...speedLimitMatchesKind.path],
  });
export type UpdateZoneRequest = z.infer<typeof updateZoneRequestSchema>;

/**
 * Result of checking whether a point is a legal place to end a ride.
 * When `allowed` is false, `nearestParkingZone` drives the "walk 120 m to the
 * nearest parking" screen.
 */
export const parkingCheckSchema = z.object({
  allowed: z.boolean(),
  reason: z
    .enum(['ok', 'outside_parking_zone', 'inside_forbidden_zone', 'outside_service_area'])
    .describe('Why parking here is or is not permitted'),
  zoneId: idSchema.nullable(),
  nearestParkingZone: z
    .object({
      id: idSchema,
      name: z.string(),
      /** Straight-line distance in metres from the rider to the zone boundary. */
      distanceM: z.number().nonnegative(),
      geom: geoPolygonSchema,
    })
    .nullable(),
});
export type ParkingCheck = z.infer<typeof parkingCheckSchema>;
