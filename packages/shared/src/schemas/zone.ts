import { z } from 'zod';
import { geoPolygonSchema } from '../geo.js';
import { idSchema } from './common.js';

/**
 * `service`   — riders may ride here at all; leaving it is blocked.
 * `parking`   — a ride may only be ended inside one of these.
 * `forbidden` — riding and parking are both refused here.
 */
export const zoneKindSchema = z.enum(['service', 'parking', 'forbidden']);
export type ZoneKind = z.infer<typeof zoneKindSchema>;

export const zoneSchema = z.object({
  id: idSchema,
  name: z.string(),
  kind: zoneKindSchema,
  geom: geoPolygonSchema,
  areaId: idSchema.nullable(),
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

export const createZoneRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: zoneKindSchema,
  geom: geoPolygonSchema,
  areaId: idSchema.nullable().optional(),
});
export type CreateZoneRequest = z.infer<typeof createZoneRequestSchema>;

export const updateZoneRequestSchema = createZoneRequestSchema.partial();
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
