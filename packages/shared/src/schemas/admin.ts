import { z } from 'zod';
import { idSchema, timestampSchema } from './common.js';

/**
 * Two roles, and the difference between them is not what they can do — it is
 * who decides.
 *
 * `owner` is the account the system is seeded with. It passes every permission
 * check unconditionally and is the only role allowed to create, edit or delete
 * other admins. `staff` can do exactly what an owner ticked for them in
 * `permissions`, and nothing else.
 */
export const adminRoleSchema = z.enum(['owner', 'staff']);
export type AdminRole = z.infer<typeof adminRoleSchema>;

/**
 * The panel's sections, which are also the unit of permission. One entry per
 * item in the sidebar, plus `admins` for this screen itself.
 */
export const adminSectionSchema = z.enum([
  'dashboard',
  'vehicles',
  'rides',
  'subscriptions',
  'users',
  'plans',
  'zones',
  'audit',
  'admins',
]);
export type AdminSection = z.infer<typeof adminSectionSchema>;

export const ADMIN_SECTIONS: readonly AdminSection[] = adminSectionSchema.options;

/**
 * What an admin may do in one section.
 *
 * `none` is absence, not a greyed-out button: the section is missing from the
 * menu and its route redirects away. `view` reads; `manage` also writes.
 */
export const adminAccessSchema = z.enum(['none', 'view', 'manage']);
export type AdminAccess = z.infer<typeof adminAccessSchema>;

/** Ordering, so "at least view" is a comparison rather than a list of cases. */
export const ADMIN_ACCESS_RANK: Record<AdminAccess, number> = { none: 0, view: 1, manage: 2 };

/**
 * Every section an admin may reach, and how far.
 *
 * Sections are stored sparsely — an absent key means `none`, so a permission
 * added to this enum later is denied by default for everyone rather than
 * silently granted. Read it through `adminCan`, never by indexing.
 */
export const adminPermissionsSchema = z.partialRecord(adminSectionSchema, adminAccessSchema);
export type AdminPermissions = z.infer<typeof adminPermissionsSchema>;

export const adminSchema = z.object({
  id: idSchema,
  email: z.email(),
  role: adminRoleSchema,
  permissions: adminPermissionsSchema,
});
export type Admin = z.infer<typeof adminSchema>;

/**
 * Whether this admin may act on `section` at `level`.
 *
 * The one implementation, used by the API middleware and by the panel's access
 * control provider — so a button the panel hides is also a request the API
 * refuses, rather than two rules that can drift apart.
 */
export function adminCan(
  admin: { role: AdminRole; permissions: AdminPermissions },
  section: AdminSection,
  level: Exclude<AdminAccess, 'none'> = 'view',
): boolean {
  if (admin.role === 'owner') return true;
  const granted = admin.permissions[section] ?? 'none';
  return ADMIN_ACCESS_RANK[granted] >= ADMIN_ACCESS_RANK[level];
}

/** Read-only across everything but the admins screen — a sensible starting tick. */
export const READ_ONLY_PERMISSIONS: AdminPermissions = {
  dashboard: 'view',
  vehicles: 'view',
  rides: 'view',
  subscriptions: 'view',
  users: 'view',
  plans: 'view',
  zones: 'view',
  audit: 'view',
};

export const createAdminRequestSchema = z.object({
  email: z.email(),
  /** Set by the owner and handed over in person; there is no reset email. */
  password: z.string().min(8).max(200),
  permissions: adminPermissionsSchema,
});
export type CreateAdminRequest = z.infer<typeof createAdminRequestSchema>;

export const updateAdminRequestSchema = z.object({
  permissions: adminPermissionsSchema.optional(),
  /** Omitted leaves the password alone. */
  password: z.string().min(8).max(200).optional(),
});
export type UpdateAdminRequest = z.infer<typeof updateAdminRequestSchema>;

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
  /** Calendar day in Asia/Samarkand, as `YYYY-MM-DD`. */
  date: z.string(),
  revenueTiyin: z.int().nonnegative(),
  rides: z.int().nonnegative(),
});
export type RevenuePoint = z.infer<typeof revenuePointSchema>;
