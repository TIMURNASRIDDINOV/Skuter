import { z } from 'zod';
import { idSchema, timestampSchema } from './common.js';

export const adminRoleSchema = z.enum(['owner', 'operator', 'viewer']);
export type AdminRole = z.infer<typeof adminRoleSchema>;

export const adminSchema = z.object({
  id: idSchema,
  email: z.email(),
  role: adminRoleSchema,
});
export type Admin = z.infer<typeof adminSchema>;

export const auditLogEntrySchema = z.object({
  id: idSchema,
  adminId: idSchema.nullable(),
  /** Verb, e.g. `zone.create`, `vehicle.status_change`. */
  action: z.string(),
  /** Entity kind the action touched, e.g. `zone`, `vehicle`. */
  entity: z.string(),
  entityId: idSchema.nullable(),
  /** Arbitrary JSON detail — before/after values, request body, etc. */
  payload: z.unknown(),
  createdAt: timestampSchema,
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

/** Joined shape for the audit log table, so it can show who did what. */
export const auditLogRowSchema = auditLogEntrySchema.extend({
  adminEmail: z.string().nullable(),
});
export type AuditLogRow = z.infer<typeof auditLogRowSchema>;

export const listAuditLogQuerySchema = z.object({
  entity: z.string().optional(),
  action: z.string().optional(),
  adminId: idSchema.optional(),
});
export type ListAuditLogQuery = z.infer<typeof listAuditLogQuerySchema>;

/** KPI cards on the dashboard. */
export const dashboardStatsSchema = z.object({
  vehiclesTotal: z.int().nonnegative(),
  vehiclesAvailable: z.int().nonnegative(),
  vehiclesInUse: z.int().nonnegative(),
  vehiclesOffline: z.int().nonnegative(),
  vehiclesLowBattery: z.int().nonnegative(),
  vehiclesMaintenance: z.int().nonnegative(),
  ridesActive: z.int().nonnegative(),
  ridesToday: z.int().nonnegative(),
  subscriptionsActive: z.int().nonnegative(),
  usersTotal: z.int().nonnegative(),
  /** Revenue in tiyin for the last 24h and the last 7 days. */
  revenueTodayTiyin: z.int().nonnegative(),
  revenueWeekTiyin: z.int().nonnegative(),
  averageBatteryPct: z.number().min(0).max(100),
});
export type DashboardStats = z.infer<typeof dashboardStatsSchema>;

export const revenuePointSchema = z.object({
  /** Calendar day in Asia/Tashkent, as `YYYY-MM-DD`. */
  date: z.string(),
  revenueTiyin: z.int().nonnegative(),
  rides: z.int().nonnegative(),
});
export type RevenuePoint = z.infer<typeof revenuePointSchema>;
