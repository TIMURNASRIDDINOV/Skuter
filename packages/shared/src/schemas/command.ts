import { z } from 'zod';
import { idSchema, timestampSchema } from './common.js';

export const commandTypeSchema = z.enum(['unlock', 'lock', 'beep', 'locate']);
export type CommandType = z.infer<typeof commandTypeSchema>;

export const commandStatusSchema = z.enum(['pending', 'sent', 'acked', 'failed']);
export type CommandStatus = z.infer<typeof commandStatusSchema>;

export const commandSchema = z.object({
  id: idSchema,
  vehicleId: idSchema,
  type: commandTypeSchema,
  status: commandStatusSchema,
  sentAt: timestampSchema.nullable(),
  ackedAt: timestampSchema.nullable(),
});
export type Command = z.infer<typeof commandSchema>;

/**
 * What a `VehicleGateway` call resolves to. Failure is a normal outcome, not
 * an exception — the simulated gateway fails unlocks ~8% of the time and the
 * app must roll its optimistic UI back.
 */
export const commandResultSchema = z.object({
  commandId: idSchema,
  vehicleId: idSchema,
  type: commandTypeSchema,
  status: commandStatusSchema,
  ok: z.boolean(),
  /** Populated when `ok` is false; safe to show to the rider. */
  failureReason: z.string().nullable(),
  /** Round-trip time the command took, in milliseconds. */
  latencyMs: z.int().nonnegative(),
});
export type CommandResult = z.infer<typeof commandResultSchema>;

/** A telemetry frame pushed by the gateway on every tick. */
export const telemetrySchema = z.object({
  vehicleId: idSchema,
  batteryPct: z.int().min(0).max(100),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** Ground speed in metres per second. */
  speedMps: z.number().nonnegative(),
  reportedAt: timestampSchema,
});
export type Telemetry = z.infer<typeof telemetrySchema>;
