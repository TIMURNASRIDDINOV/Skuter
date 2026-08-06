import { z } from 'zod';
import { latLonSchema } from '../geo.js';
import { idSchema, timestampSchema } from './common.js';

export const vehicleStatusSchema = z.enum([
  'available',
  'in_use',
  'reserved',
  'offline',
  'low_battery',
  'maintenance',
]);
export type VehicleStatus = z.infer<typeof vehicleStatusSchema>;

/**
 * A second axis over status: status says *what* a vehicle is, severity says
 * *how much it should worry you*.
 *
 * It lives here rather than in either client because both need to agree. The
 * back office ranks its attention queue by it; the rider app decides from it
 * whether a scooter is offered at all. Rendering stays per app — the panel
 * draws Ant Design tags in Russian, the rider app draws React Native views in
 * RU/UZ — but the classification is one thing in one place.
 */
export const severitySchema = z.enum(['ok', 'watch', 'alarm']);
export type Severity = z.infer<typeof severitySchema>;

/** Sort key for mixed lists of problems, most urgent first. */
export const SEVERITY_RANK: Record<Severity, number> = { alarm: 0, watch: 1, ok: 2 };

/**
 * `reserved` is deliberately `ok`: a held scooter is the system working, not a
 * fault. `low_battery` is `watch` rather than `alarm` because the fleet always
 * has some — it is a dispatch queue, not an incident.
 */
export const VEHICLE_STATUS_SEVERITY: Record<VehicleStatus, Severity> = {
  available: 'ok',
  in_use: 'ok',
  reserved: 'ok',
  low_battery: 'watch',
  maintenance: 'watch',
  offline: 'alarm',
};

/** Statuses a rider is allowed to unlock. */
export const RIDEABLE_VEHICLE_STATUSES: readonly VehicleStatus[] = ['available', 'reserved'];

/** Statuses that appear as pins on the public rider map. */
export const PUBLIC_VEHICLE_STATUSES: readonly VehicleStatus[] = ['available', 'low_battery'];

/** Printed on the scooter and encoded in its QR sticker, e.g. `SCOOT-0042`. */
export const qrCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^SCOOT-\d{4}$/, 'QR code must look like SCOOT-0042');

export const batteryPctSchema = z.int().min(0).max(100);

/** What riders see. Deliberately omits IMEI — that is fleet-operator data. */
export const vehicleSchema = z.object({
  id: idSchema,
  qrCode: qrCodeSchema,
  model: z.string(),
  status: vehicleStatusSchema,
  batteryPct: batteryPctSchema,
  location: latLonSchema,
  /** Estimated remaining range in metres, derived from battery percentage. */
  rangeM: z.int().nonnegative(),
  lastSeenAt: timestampSchema,
  areaId: idSchema.nullable(),
  /**
   * When the current hold lapses, or null if the scooter is not held.
   *
   * Deliberately does *not* say who holds it — that is another rider's
   * business. The rider app learns a hold is theirs because the scooter is
   * still in their list at all; see `listPublic`.
   */
  reservedUntil: timestampSchema.nullable(),
});
export type Vehicle = z.infer<typeof vehicleSchema>;

/** What the back office sees — everything, including hardware identity. */
export const adminVehicleSchema = vehicleSchema.extend({
  imei: z.string(),
});
export type AdminVehicle = z.infer<typeof adminVehicleSchema>;

export const listVehiclesQuerySchema = z.object({
  status: vehicleStatusSchema.optional(),
  /** Restrict to vehicles within `radiusM` of this point. */
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  radiusM: z.coerce.number().int().min(1).max(50_000).optional(),
});
export type ListVehiclesQuery = z.infer<typeof listVehiclesQuerySchema>;

export const updateVehicleRequestSchema = z.object({
  status: vehicleStatusSchema.optional(),
  model: z.string().trim().min(1).max(80).optional(),
  areaId: idSchema.nullable().optional(),
});
export type UpdateVehicleRequest = z.infer<typeof updateVehicleRequestSchema>;
