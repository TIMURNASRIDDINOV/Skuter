import { and, asc, eq, sql } from 'drizzle-orm';
import type { Area, GeoPolygon, LatLon, ListZonesQuery, Zone, ZoneKind } from '@ozothunder/shared';
import type { Database } from '../db/client.js';
import { selectPolygon } from '../db/sql.js';
import { areas, zones } from '../db/schema.js';
import { toZone, type ZoneRow } from './mappers.js';

const zoneColumns = {
  id: zones.id,
  name: zones.name,
  kind: zones.kind,
  geom: selectPolygon(zones.geom),
  areaId: zones.areaId,
  speedLimitKph: zones.speedLimitKph,
} as const;

const areaColumns = {
  id: areas.id,
  name: areas.name,
  geom: selectPolygon(areas.geom),
} as const;

export interface NewZone {
  name: string;
  kind: ZoneKind;
  geom: GeoPolygon;
  areaId: string | null;
  /** Required on `slow` zones, null on every other kind. */
  speedLimitKph: number | null;
}

// Raw rows from the PostGIS containment queries. Declared as type aliases, not
// interfaces: db.execute<T> constrains T to Record<string, unknown>, and only
// type aliases get an implicit index signature.
type ZoneHitRow = {
  id: string;
  name: string;
};

type NearestZoneRow = {
  id: string;
  name: string;
  geom: GeoPolygon;
  distance_m: number;
};

export function createZonesRepository(db: Database) {
  return {
    async list(query: ListZonesQuery = {}): Promise<Zone[]> {
      const filters = [];
      if (query.kind !== undefined) filters.push(eq(zones.kind, query.kind));
      if (query.areaId !== undefined) filters.push(eq(zones.areaId, query.areaId));

      const rows = await db
        .select(zoneColumns)
        .from(zones)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(asc(zones.name));

      return rows.map((row) => toZone(row as ZoneRow));
    },

    async findById(id: string): Promise<Zone | null> {
      const [row] = await db.select(zoneColumns).from(zones).where(eq(zones.id, id)).limit(1);
      return row === undefined ? null : toZone(row as ZoneRow);
    },

    async insertMany(items: readonly NewZone[]): Promise<Zone[]> {
      if (items.length === 0) return [];
      const rows = await db
        .insert(zones)
        .values([...items])
        .returning(zoneColumns);
      return rows.map((row) => toZone(row as ZoneRow));
    },

    async insert(item: NewZone): Promise<Zone> {
      const [zone] = await this.insertMany([item]);
      if (zone === undefined) throw new Error('Failed to insert zone');
      return zone;
    },

    async update(id: string, patch: Partial<NewZone>): Promise<Zone | null> {
      const [row] = await db
        .update(zones)
        .set(patch)
        .where(eq(zones.id, id))
        .returning(zoneColumns);
      return row === undefined ? null : toZone(row as ZoneRow);
    },

    async delete(id: string): Promise<boolean> {
      const rows = await db.delete(zones).where(eq(zones.id, id)).returning({ id: zones.id });
      return rows.length > 0;
    },

    // --- PostGIS containment -------------------------------------------
    // These are the authoritative geofence checks. The rider app does its own
    // optimistic check for responsiveness, but the server decides.

    /** The parking zone containing this point, if any. */
    async findParkingZoneAt(point: LatLon): Promise<{ id: string; name: string } | null> {
      const result = await db.execute<ZoneHitRow>(sql`
        SELECT id, name FROM zones
        WHERE kind = 'parking'
          AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326))
        LIMIT 1
      `);
      return result.rows[0] ?? null;
    },

    /** A forbidden zone containing this point, if any. */
    async findForbiddenZoneAt(point: LatLon): Promise<{ id: string; name: string } | null> {
      const result = await db.execute<ZoneHitRow>(sql`
        SELECT id, name FROM zones
        WHERE kind = 'forbidden'
          AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326))
        LIMIT 1
      `);
      return result.rows[0] ?? null;
    },

    /** Whether the point falls inside any service area. */
    async isInsideServiceArea(point: LatLon): Promise<boolean> {
      const result = await db.execute<{ inside: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1 FROM zones
          WHERE kind = 'service'
            AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326))
        ) AS inside
      `);
      return result.rows[0]?.inside ?? false;
    },

    /**
     * Closest parking zone and how far the rider must walk to it.
     *
     * `<->` orders by index-assisted distance; ST_Distance on ::geography then
     * gives a true metre figure. On plain geometry it would return degrees,
     * which is silently wrong.
     */
    async findNearestParkingZone(
      point: LatLon,
    ): Promise<{ id: string; name: string; distanceM: number; geom: GeoPolygon } | null> {
      const result = await db.execute<NearestZoneRow>(sql`
        SELECT id, name,
               ST_AsGeoJSON(geom)::json AS geom,
               ST_Distance(
                 geom::geography,
                 ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)::geography
               ) AS distance_m
        FROM zones
        WHERE kind = 'parking'
        ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)
        LIMIT 1
      `);
      const row = result.rows[0];
      if (row === undefined) return null;
      return {
        id: row.id,
        name: row.name,
        geom: row.geom,
        distanceM: Math.round(row.distance_m),
      };
    },

    /** Parking zones within `radiusM` — used to highlight options on the map. */
    async findParkingZonesWithin(point: LatLon, radiusM: number): Promise<Zone[]> {
      const rows = await db
        .select(zoneColumns)
        .from(zones)
        .where(
          and(
            eq(zones.kind, 'parking'),
            sql`ST_DWithin(
              ${zones.geom}::geography,
              ST_SetSRID(ST_MakePoint(${point.lon}, ${point.lat}), 4326)::geography,
              ${radiusM}
            )`,
          ),
        );
      return rows.map((row) => toZone(row as ZoneRow));
    },

    async deleteAll(): Promise<void> {
      await db.delete(zones);
    },
  };
}

export function createAreasRepository(db: Database) {
  return {
    async list(): Promise<Area[]> {
      const rows = await db.select(areaColumns).from(areas).orderBy(asc(areas.name));
      return rows.map((row) => ({ id: row.id, name: row.name, geom: row.geom }));
    },

    async findById(id: string): Promise<Area | null> {
      const [row] = await db.select(areaColumns).from(areas).where(eq(areas.id, id)).limit(1);
      return row === undefined ? null : { id: row.id, name: row.name, geom: row.geom };
    },

    async insert(item: { name: string; geom: GeoPolygon }): Promise<Area> {
      const [row] = await db.insert(areas).values(item).returning(areaColumns);
      if (row === undefined) throw new Error('Failed to insert area');
      return { id: row.id, name: row.name, geom: row.geom };
    },

    async deleteAll(): Promise<void> {
      await db.delete(areas);
    },
  };
}

export type ZonesRepository = ReturnType<typeof createZonesRepository>;
export type AreasRepository = ReturnType<typeof createAreasRepository>;
