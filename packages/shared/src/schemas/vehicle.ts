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
