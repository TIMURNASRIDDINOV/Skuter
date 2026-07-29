import {
  FULL_BATTERY_RANGE_M,
  pointToLatLon,
  type Admin,
  type AuditLogRow,
  type GeoPoint,
  type Plan,
  type User,
  type Vehicle,
  type Zone,
} from '@scoot/shared';

/**
 * Row -> API shape mappers. Repositories return the types defined in
 * @scoot/shared, so no route or client ever sees a raw database row.
 */

/** Timestamps leave the database as Date and cross the wire as UTC ISO-8601. */
export function toIso(value: Date): string {
  return value.toISOString();
}

export function toIsoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** Remaining range in metres, straight-line from battery percentage. */
export function estimateRangeM(batteryPct: number): number {
  return Math.round((batteryPct / 100) * FULL_BATTERY_RANGE_M);
}

export interface VehicleRow {
  id: string;
  qrCode: string;
  imei: string;
  model: string;
  status: Vehicle['status'];
  batteryPct: number;
  geom: GeoPoint;
  lastSeenAt: Date;
  areaId: string | null;
}

export function toVehicle(row: VehicleRow): Vehicle {
  return {
    id: row.id,
    qrCode: row.qrCode,
    model: row.model,
    status: row.status,
    batteryPct: row.batteryPct,
    location: pointToLatLon(row.geom),
    rangeM: estimateRangeM(row.batteryPct),
    lastSeenAt: toIso(row.lastSeenAt),
    areaId: row.areaId,
  };
}

/** Adds IMEI — back office only, never returned to riders. */
export function toAdminVehicle(row: VehicleRow): Vehicle & { imei: string } {
  return { ...toVehicle(row), imei: row.imei };
}

export interface UserRow {
  id: string;
  phone: string | null;
  name: string | null;
  telegramId: number | null;
  status: User['status'];
  balance: number;
  createdAt: Date;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    phone: row.phone,
    name: row.name,
    telegramId: row.telegramId,
    status: row.status,
    balance: row.balance,
    createdAt: toIso(row.createdAt),
  };
}

export interface PlanRow {
  id: string;
  kind: Plan['kind'];
  name: string;
  unlockFee: number;
  price: number;
  durationDays: number | null;
}

export function toPlan(row: PlanRow): Plan {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    unlockFee: row.unlockFee,
    price: row.price,
    durationDays: row.durationDays,
  };
}

export interface ZoneRow {
  id: string;
  name: string;
  kind: Zone['kind'];
  geom: Zone['geom'];
  areaId: string | null;
}

export function toZone(row: ZoneRow): Zone {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    geom: row.geom,
    areaId: row.areaId,
  };
}

export interface AdminRow {
  id: string;
  email: string;
  role: Admin['role'];
}

export function toAdmin(row: AdminRow): Admin {
  return { id: row.id, email: row.email, role: row.role };
}

export interface AuditLogRowRaw {
  id: string;
  adminId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  payload: unknown;
  createdAt: Date;
  adminEmail: string | null;
}

export function toAuditLogRow(row: AuditLogRowRaw): AuditLogRow {
  return {
    id: row.id,
    adminId: row.adminId,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    payload: row.payload,
    createdAt: toIso(row.createdAt),
    adminEmail: row.adminEmail,
  };
}
