import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  PUBLIC_VEHICLE_STATUSES,
  latLonToPoint,
  pointToLatLon,
  type GeoPoint,
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
  reservedUntil: vehicles.reservedUntil,
} as const;

/**
 * What a hold-clearing statement reports back.
 *
 * Carries battery and position as well as status so the caller can announce
 * the change without a follow-up SELECT — which behind Hyperdrive could be
 * served from before the write anyway.
 */
export interface ReleasedVehicle {
  id: string;
  status: VehicleStatus;
  batteryPct: number;
  location: LatLon;
}

const releasedColumns = {
  id: vehicles.id,
  status: vehicles.status,
  batteryPct: vehicles.batteryPct,
  geom: selectPoint(vehicles.geom),
} as const;

function toReleased(row: {
  id: string;
  status: VehicleStatus;
  batteryPct: number;
  geom: GeoPoint;
}): ReleasedVehicle {
  return {
    id: row.id,
    status: row.status,
    batteryPct: row.batteryPct,
    location: pointToLatLon(row.geom),
  };
}

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
     *
     * `viewerId` is what keeps a rider's own held scooter on their map.
     * `reserved` is not a public status — another rider must not see a held
     * scooter at all, or they walk to a pin they cannot unlock — but the
     * holder has to keep seeing theirs or the hold is invisible to the only
     * person it belongs to.
     */
    async listPublic(query: ListVehiclesQuery = {}, viewerId?: string): Promise<Vehicle[]> {
      const visible =
        viewerId === undefined
          ? inArray(vehicles.status, [...PUBLIC_VEHICLE_STATUSES])
          : sql`(
              ${inArray(vehicles.status, [...PUBLIC_VEHICLE_STATUSES])}
              OR (${vehicles.status} = 'reserved' AND ${vehicles.reservedBy} = ${viewerId})
            )`;

      const filters = [
        visible,
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

    // --- reservations ----------------------------------------------------
    // These write only the hold columns. The vehicle's *status* is moved by
    // services/reservations.ts through the gateway, never from here — see the
    // note there about the simulator tick rewriting status from memory.
    //
    // **Every one of these reports its outcome through RETURNING rather than a
    // follow-up SELECT.** On Cloudflare the database is behind Hyperdrive,
    // which caches read queries: a SELECT issued straight after a write can be
    // served from before it. Read-modify-write built on those reads misbehaved
    // in exactly the ways you would predict — releases quietly became no-ops,
    // so a rider accumulated holds, and a cleared hold kept its `reserved`
    // status because the status check read a stale row. Writes are never
    // cached, so a RETURNING clause is always the truth.

    /** Who holds this vehicle and until when, ignoring lapsed holds. */
    async findHold(id: string): Promise<{ userId: string; until: Date } | null> {
      const [row] = await db
        .select({ userId: vehicles.reservedBy, until: vehicles.reservedUntil })
        .from(vehicles)
        .where(eq(vehicles.id, id))
        .limit(1);

      if (row?.userId == null || row.until === null) return null;
      if (row.until.getTime() <= Date.now()) return null;
      return { userId: row.userId, until: row.until };
    },

    /**
     * Claim a hold, but only if nobody else already has a live one.
     *
     * The `reserved_until IS NULL OR reserved_until <= now()` guard makes this
     * the atomic step: two riders tapping "hold" on the same scooter both run
     * this UPDATE, and Postgres row-locking means exactly one matches. Without
     * it the check and the write would be two statements with a race between.
     */
    async claimHold(
      id: string,
      userId: string,
      until: Date,
    ): Promise<{ status: VehicleStatus } | null> {
      const [row] = await db
        .update(vehicles)
        .set({ reservedUntil: until, reservedBy: userId })
        .where(
          and(
            eq(vehicles.id, id),
            sql`(${vehicles.reservedUntil} IS NULL OR ${vehicles.reservedUntil} <= now())`,
          ),
        )
        .returning({ status: vehicles.status });
      return row === undefined ? null : { status: row.status };
    },

    /**
     * Drop the hold only if `userId` owns it, in one statement.
     *
     * Returns null when there was no live hold or it belonged to somebody
     * else — the caller cannot tell those apart, and does not need to.
     */
    async clearHoldOwnedBy(id: string, userId: string): Promise<ReleasedVehicle | null> {
      const [row] = await db
        .update(vehicles)
        .set({ reservedUntil: null, reservedBy: null })
        .where(
          and(
            eq(vehicles.id, id),
            eq(vehicles.reservedBy, userId),
            sql`${vehicles.reservedUntil} IS NOT NULL AND ${vehicles.reservedUntil} > now()`,
          ),
        )
        .returning(releasedColumns);
      return row === undefined ? null : toReleased(row as Parameters<typeof toReleased>[0]);
    },

    /**
     * Clear every live hold this rider owns except `keepVehicleId`, in one
     * statement. A rider holds one scooter at a time; without this, walking
     * past a nicer one and holding that too takes both off the map.
     */
    async clearOtherHoldsOf(
      userId: string,
      keepVehicleId: string,
    ): Promise<ReleasedVehicle[]> {
      const rows = await db
        .update(vehicles)
        .set({ reservedUntil: null, reservedBy: null })
        .where(
          and(
            eq(vehicles.reservedBy, userId),
            sql`${vehicles.id} <> ${keepVehicleId}`,
            sql`${vehicles.reservedUntil} IS NOT NULL`,
          ),
        )
        .returning(releasedColumns);
      return rows.map((row) => toReleased(row as Parameters<typeof toReleased>[0]));
    },

    /** Clear every lapsed hold in one statement, reporting what it touched. */
    async clearLapsedHolds(): Promise<ReleasedVehicle[]> {
      const rows = await db
        .update(vehicles)
        .set({ reservedUntil: null, reservedBy: null })
        .where(sql`${vehicles.reservedUntil} IS NOT NULL AND ${vehicles.reservedUntil} <= now()`)
        .returning(releasedColumns);
      return rows.map((row) => toReleased(row as Parameters<typeof toReleased>[0]));
    },

    /** The live hold this rider owns, if any. A rider holds at most one. */
    async findHeldBy(userId: string): Promise<{ vehicle: Vehicle; until: Date } | null> {
      const [row] = await db
        .select(columns)
        .from(vehicles)
        .where(
          and(
            eq(vehicles.reservedBy, userId),
            sql`${vehicles.reservedUntil} IS NOT NULL AND ${vehicles.reservedUntil} > now()`,
          ),
        )
        // One hold per rider is the invariant, but order anyway so that if it
        // is ever violated the newest hold wins rather than an arbitrary row.
        .orderBy(desc(vehicles.reservedUntil))
        .limit(1);

      if (row?.reservedUntil == null) return null;
      return { vehicle: toVehicle(row as VehicleRow), until: row.reservedUntil };
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
