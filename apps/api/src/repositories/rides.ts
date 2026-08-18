import { and, desc, eq, sql } from 'drizzle-orm';
import type { GeoLineString, LatLon, Ride, RideStatus } from '@scoot/shared';
import type { Database } from '../db/client.js';
import { selectLineString } from '../db/sql.js';
import { rides, users, vehicles } from '../db/schema.js';
import { toIso, toIsoOrNull } from './mappers.js';

/** A ride joined with the labels the admin tables actually display. */
export interface RideWithContext extends Ride {
  vehicleQrCode: string;
  userPhone: string | null;
}

/**
 * Ride persistence. Checkpoint 2 uses the create/progress half so the
 * simulator can drive vehicles along a route; Checkpoint 3 adds the end-ride
 * lifecycle, geofence validation and cost settlement.
 */

interface RideRow {
  id: string;
  userId: string;
  vehicleId: string;
  planId: string;
  startedAt: Date;
  endedAt: Date | null;
  path: GeoLineString | null;
  distanceM: number;
  durationS: number;
  cost: number;
  endZoneId: string | null;
  status: RideStatus;
}

const columns = {
  id: rides.id,
  userId: rides.userId,
  vehicleId: rides.vehicleId,
  planId: rides.planId,
  startedAt: rides.startedAt,
  endedAt: rides.endedAt,
  path: selectLineString(rides.path),
  distanceM: rides.distanceM,
  durationS: rides.durationS,
  cost: rides.cost,
  endZoneId: rides.endZoneId,
  status: rides.status,
} as const;

function toRide(row: RideRow): Ride {
  return {
    id: row.id,
    userId: row.userId,
    vehicleId: row.vehicleId,
    startedAt: toIso(row.startedAt),
    endedAt: toIsoOrNull(row.endedAt),
    path: row.path,
    distanceM: row.distanceM,
    durationS: row.durationS,
    cost: row.cost,
    endZoneId: row.endZoneId,
    status: row.status,
  };
}

export interface RideProgress {
  path: LatLon[];
  distanceM: number;
  durationS: number;
}

export function createRidesRepository(db: Database) {
  return {
    async create(input: {
      userId: string;
      vehicleId: string;
      planId: string;
      startedAt: Date;
    }): Promise<string> {
      const [row] = await db.insert(rides).values(input).returning({ id: rides.id });
      if (row === undefined) throw new Error('Failed to create ride');
      return row.id;
    },

    async findById(id: string): Promise<Ride | null> {
      const [row] = await db.select(columns).from(rides).where(eq(rides.id, id)).limit(1);
      return row === undefined ? null : toRide(row as RideRow);
    },

    async findActiveByVehicle(vehicleId: string): Promise<Ride | null> {
      const [row] = await db
        .select(columns)
        .from(rides)
        .where(and(eq(rides.vehicleId, vehicleId), eq(rides.status, 'active')))
        .limit(1);
      return row === undefined ? null : toRide(row as RideRow);
    },

    async findActiveByUser(userId: string): Promise<Ride | null> {
      const [row] = await db
        .select(columns)
        .from(rides)
        .where(and(eq(rides.userId, userId), eq(rides.status, 'active')))
        .limit(1);
      return row === undefined ? null : toRide(row as RideRow);
    },

    async listActive(): Promise<Ride[]> {
      const rows = await db.select(columns).from(rides).where(eq(rides.status, 'active'));
      return rows.map((row) => toRide(row as RideRow));
    },

    async countActive(): Promise<number> {
      const result = await db.execute<{ total: number }>(
        sql`SELECT count(*)::int AS total FROM rides WHERE status = 'active'`,
      );
      return result.rows[0]?.total ?? 0;
    },

    /** The plan a ride was started under — needed to price or explain it. */
    async findPlanId(id: string): Promise<string | null> {
      const [row] = await db
        .select({ planId: rides.planId })
        .from(rides)
        .where(eq(rides.id, id))
        .limit(1);
      return row?.planId ?? null;
    },

    /** Closes a ride out. Called once, at end-ride. */
    async settle(
      id: string,
      outcome: {
        endedAt: Date;
        distanceM: number;
        durationS: number;
        cost: number;
        endZoneId: string | null;
        path: LatLon[] | null;
      },
    ): Promise<void> {
      const path: GeoLineString | null =
        outcome.path !== null && outcome.path.length >= 2
          ? {
              type: 'LineString',
              coordinates: outcome.path.map((p) => [p.lon, p.lat] as [number, number]),
            }
          : null;

      await db
        .update(rides)
        .set({
          status: 'completed',
          endedAt: outcome.endedAt,
          distanceM: outcome.distanceM,
          durationS: outcome.durationS,
          cost: outcome.cost,
          endZoneId: outcome.endZoneId,
          ...(path === null ? {} : { path }),
        })
        .where(eq(rides.id, id));
    },

    async listForUser(userId: string, limit = 50): Promise<Ride[]> {
      const rows = await db
        .select(columns)
        .from(rides)
        .where(eq(rides.userId, userId))
        .orderBy(desc(rides.startedAt))
        .limit(limit);
      return rows.map((row) => toRide(row as RideRow));
    },

    async listAll(query: { status?: RideStatus } = {}, limit = 200): Promise<RideWithContext[]> {
      const rows = await db
        .select({
          ...columns,
          vehicleQrCode: vehicles.qrCode,
          userPhone: users.phone,
        })
        .from(rides)
        .innerJoin(vehicles, eq(rides.vehicleId, vehicles.id))
        .innerJoin(users, eq(rides.userId, users.id))
        .where(query.status === undefined ? undefined : eq(rides.status, query.status))
        .orderBy(desc(rides.startedAt))
        .limit(limit);

      return rows.map((row) => ({
        ...toRide(row as RideRow),
        vehicleQrCode: row.vehicleQrCode,
        userPhone: row.userPhone,
      }));
    },

    /** Revenue and ride counts per day in Asia/Tashkent, for the admin chart. */
    async revenueByDay(days: number): Promise<{ date: string; revenueTiyin: number; rides: number }[]> {
      const result = await db.execute<{ date: string; revenue: number; rides: number }>(sql`
        SELECT to_char((ended_at AT TIME ZONE 'Asia/Tashkent')::date, 'YYYY-MM-DD') AS date,
               COALESCE(sum(cost), 0)::bigint AS revenue,
               count(*)::int AS rides
        FROM rides
        WHERE status = 'completed'
          AND ended_at >= now() - make_interval(days => ${days})
        GROUP BY 1
        ORDER BY 1
      `);
      return result.rows.map((row) => ({
        date: row.date,
        revenueTiyin: Number(row.revenue),
        rides: row.rides,
      }));
    },

    async countCompletedSince(since: Date): Promise<{ rides: number; revenueTiyin: number }> {
      const result = await db.execute<{ rides: number; revenue: number }>(sql`
        SELECT count(*)::int AS rides, COALESCE(sum(cost), 0)::bigint AS revenue
        FROM rides
        WHERE status = 'completed' AND ended_at >= ${since.toISOString()}
      `);
      const row = result.rows[0];
      return { rides: row?.rides ?? 0, revenueTiyin: Number(row?.revenue ?? 0) };
    },

    /**
     * One statement for every ride in flight.
     *
     * The simulator advances each active ride on every tick. Issued one row at
     * a time this was the largest single source of query volume on Cloudflare:
     * a tick cost 1 + N round-trips through Hyperdrive, all day, whether or not
     * anybody was connected. Batched, a tick costs two statements regardless of
     * how many rides are running.
     *
     * `ST_GeomFromGeoJSON(NULL)` is NULL, so the COALESCE keeps whatever path a
     * ride already had — a ride that has not yet moved twice cannot form a
     * LineString and must not have its path overwritten with null.
     */
    async updateProgressBatch(
      items: readonly { id: string; path: LatLon[]; distanceM: number; durationS: number }[],
    ): Promise<void> {
      if (items.length === 0) return;

      const rows = items.map((item) => {
        const path =
          item.path.length >= 2
            ? JSON.stringify({
                type: 'LineString',
                coordinates: item.path.map((p) => [p.lon, p.lat]),
              })
            : null;

        return sql`(${item.id}::uuid, ${Math.round(item.distanceM)}::integer, ${Math.round(item.durationS)}::integer, ${path}::text)`;
      });

      await db.execute(sql`
        UPDATE rides AS r
        SET distance_m = t.distance_m,
            duration_s = t.duration_s,
            path = COALESCE(ST_SetSRID(ST_GeomFromGeoJSON(t.path), 4326), r.path)
        FROM (VALUES ${sql.join(rows, sql`, `)}) AS t(id, distance_m, duration_s, path)
        WHERE r.id = t.id
      `);
    },

    /**
     * Writes the accumulated track. A LineString needs at least two positions,
     * so a ride that has not moved yet keeps a null path.
     */
    async updateProgress(id: string, progress: RideProgress): Promise<void> {
      const path: GeoLineString | null =
        progress.path.length >= 2
          ? {
              type: 'LineString',
              coordinates: progress.path.map((p) => [p.lon, p.lat] as [number, number]),
            }
          : null;

      await db
        .update(rides)
        .set({
          distanceM: Math.round(progress.distanceM),
          durationS: Math.round(progress.durationS),
          ...(path === null ? {} : { path }),
        })
        .where(eq(rides.id, id));
    },
  };
}

export type RidesRepository = ReturnType<typeof createRidesRepository>;
