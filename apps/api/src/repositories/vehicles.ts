import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import {
  PUBLIC_VEHICLE_STATUSES,
  latLonToPoint,
  type AdminVehicle,
  type LatLon,
  type ListVehiclesQuery,
  type Vehicle,
  type VehicleStatus,
} from '@scoot/shared';
import type { Database } from '../db/client.js';
import { selectPoint } from '../db/sql.js';
import { subscriptions, vehicles } from '../db/schema.js';
import { toAdminVehicle, toVehicle, type VehicleRow } from './mappers.js';

/**
 * Vehicle reads and writes. Nothing outside this module queries the vehicles
 * table.
 */

const columns = {
  id: vehicles.id,
  qrCode: vehicles.qrCode,
  imei: vehicles.imei,
  model: vehicles.model,
  status: vehicles.status,
  batteryPct: vehicles.batteryPct,
  geom: selectPoint(vehicles.geom),
  lastSeenAt: vehicles.lastSeenAt,
  areaId: vehicles.areaId,
} as const;

export interface NewVehicle {
  qrCode: string;
  imei: string;
  model: string;
  status: VehicleStatus;
  batteryPct: number;
  location: LatLon;
  areaId: string | null;
}

export function createVehiclesRepository(db: Database) {
  return {
    /** Every vehicle, back-office view (includes IMEI). */
    async listAll(query: ListVehiclesQuery = {}): Promise<AdminVehicle[]> {
      const filters = [];
      if (query.status !== undefined) filters.push(eq(vehicles.status, query.status));
      if (query.lat !== undefined && query.lon !== undefined && query.radiusM !== undefined) {
        filters.push(withinRadius(query.lat, query.lon, query.radiusM));
      }

      const rows = await db
        .select(columns)
        .from(vehicles)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(asc(vehicles.qrCode));

      return rows.map((row) => toAdminVehicle(row as VehicleRow));
    },

    /**
     * What the rider map shows: rideable vehicles only, minus any currently
     * bound to somebody's active subscription.
     */
    async listPublic(query: ListVehiclesQuery = {}): Promise<Vehicle[]> {
      const filters = [
        inArray(vehicles.status, [...PUBLIC_VEHICLE_STATUSES]),
        sql`NOT EXISTS (
          SELECT 1 FROM ${subscriptions}
          WHERE ${subscriptions.vehicleId} = ${vehicles.id}
            AND ${subscriptions.status} = 'active'
            AND ${subscriptions.expiresAt} > now()
        )`,
      ];
      if (query.lat !== undefined && query.lon !== undefined && query.radiusM !== undefined) {
        filters.push(withinRadius(query.lat, query.lon, query.radiusM));
      }

      const rows = await db
        .select(columns)
        .from(vehicles)
        .where(and(...filters))
        .orderBy(asc(vehicles.qrCode));

      return rows.map((row) => toVehicle(row as VehicleRow));
    },

    async findById(id: string): Promise<AdminVehicle | null> {
      const [row] = await db.select(columns).from(vehicles).where(eq(vehicles.id, id)).limit(1);
      return row === undefined ? null : toAdminVehicle(row as VehicleRow);
    },

    async findByQrCode(qrCode: string): Promise<AdminVehicle | null> {
      const [row] = await db
        .select(columns)
        .from(vehicles)
        .where(eq(vehicles.qrCode, qrCode))
        .limit(1);
      return row === undefined ? null : toAdminVehicle(row as VehicleRow);
    },

    async countByStatus(): Promise<Record<VehicleStatus, number>> {
      const rows = await db
        .select({ status: vehicles.status, total: count() })
        .from(vehicles)
        .groupBy(vehicles.status);

      const tally: Record<VehicleStatus, number> = {
        available: 0,
        in_use: 0,
        reserved: 0,
        offline: 0,
        low_battery: 0,
        maintenance: 0,
      };
      for (const row of rows) tally[row.status] = row.total;
      return tally;
    },

    /** Fleet-wide mean battery, for the dashboard KPI card. */
    async averageBattery(): Promise<number> {
      const [row] = await db.select({ avg: sql<number>`COALESCE(avg(battery_pct), 0)::float` }).from(vehicles);
      return Math.round((row?.avg ?? 0) * 10) / 10;
    },

    async count(): Promise<number> {
      const [row] = await db.select({ total: count() }).from(vehicles);
      return row?.total ?? 0;
    },

    async insertMany(items: readonly NewVehicle[]): Promise<void> {
      if (items.length === 0) return;
      await db.insert(vehicles).values(
        items.map((item) => ({
          qrCode: item.qrCode,
          imei: item.imei,
          model: item.model,
          status: item.status,
          batteryPct: item.batteryPct,
          geom: latLonToPoint(item.location),
          areaId: item.areaId,
        })),
      );
    },

    async updateStatus(id: string, status: VehicleStatus): Promise<void> {
      await db.update(vehicles).set({ status }).where(eq(vehicles.id, id));
    },

    /** Applied by the simulator on every tick. */
    async updateTelemetry(
      id: string,
      telemetry: { location: LatLon; batteryPct: number; lastSeenAt: Date },
    ): Promise<void> {
      await db
        .update(vehicles)
        .set({
          geom: latLonToPoint(telemetry.location),
          batteryPct: telemetry.batteryPct,
          lastSeenAt: telemetry.lastSeenAt,
        })
        .where(eq(vehicles.id, id));
    },

    /**
     * One statement for the whole fleet. The simulator writes 70 vehicles
     * every 3 seconds; doing that as 70 round-trips would dominate the tick.
     */
    async updateTelemetryBatch(
      items: readonly { id: string; location: LatLon; batteryPct: number; status?: VehicleStatus }[],
    ): Promise<void> {
      if (items.length === 0) return;

      const rows = items.map(
        (item) =>
          sql`(${item.id}::uuid, ${item.location.lon}::double precision, ${item.location.lat}::double precision, ${item.batteryPct}::smallint, ${item.status ?? null}::vehicle_status)`,
      );

      await db.execute(sql`
        UPDATE vehicles AS v
        SET geom = ST_SetSRID(ST_MakePoint(t.lon, t.lat), 4326),
            battery_pct = t.battery_pct,
            status = COALESCE(t.status, v.status),
            last_seen_at = now()
        FROM (VALUES ${sql.join(rows, sql`, `)}) AS t(id, lon, lat, battery_pct, status)
        WHERE v.id = t.id
      `);
    },

    async deleteAll(): Promise<void> {
      await db.delete(vehicles);
    },
  };
}

/** ST_DWithin on geography gives a true metre radius rather than degrees. */
function withinRadius(lat: number, lon: number, radiusM: number) {
  return sql`ST_DWithin(
    ${vehicles.geom}::geography,
    ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
    ${radiusM}
  )`;
}

export type VehiclesRepository = ReturnType<typeof createVehiclesRepository>;
