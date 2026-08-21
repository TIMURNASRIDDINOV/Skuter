import { sql, type SQL } from 'drizzle-orm';
import { customType } from 'drizzle-orm/pg-core';
import type { GeoLineString, GeoPoint, GeoPolygon } from '@ozothunder/shared';

/**
 * PostGIS column types.
 *
 * All three are custom types rather than Drizzle's native `geometry()` helper.
 * Polygon and LineString are not predefined by Drizzle at all, and for `point`
 * drizzle-kit drops the `srid` option from the emitted DDL — it generates
 * `geometry(point)`, i.e. SRID 0. Mixing that with the SRID 4326 zone polygons
 * makes ST_Contains / ST_DWithin fail with "Operation on mixed SRID
 * geometries", so the SRID is pinned here instead.
 *
 * Writes go out as `ST_SetSRID(ST_GeomFromGeoJSON(...), 4326)`.
 * Reads must come back through `asGeoJson()` — Postgres serialises geometry as
 * WKB hex by default, which is useless to the client. Repositories always
 * select geometry through that helper; `fromDriver` throws loudly if a query
 * ever forgets, rather than silently returning a hex blob.
 */

export const SRID = 4326;

function parseGeoJson<T>(value: unknown, columnType: string): T {
  // `::json` casts arrive already parsed by node-postgres.
  if (typeof value === 'object' && value !== null) {
    return value as T;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{')) {
      return JSON.parse(trimmed) as T;
    }
    throw new Error(
      `Expected GeoJSON for ${columnType} but received raw geometry ("${trimmed.slice(0, 16)}…"). ` +
        `Select this column through asGeoJson() so PostGIS emits ST_AsGeoJSON.`,
    );
  }
  throw new Error(`Expected GeoJSON for ${columnType}, received ${typeof value}`);
}

/** GeoJSON Point stored as `geometry(Point,4326)`. */
export const point4326 = customType<{ data: GeoPoint; driverData: string }>({
  dataType() {
    return `geometry(Point,${SRID})`;
  },
  toDriver(value: GeoPoint): SQL {
    return sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(value)}), ${sql.raw(String(SRID))})`;
  },
  fromDriver(value: string): GeoPoint {
    return parseGeoJson<GeoPoint>(value, 'geometry(Point,4326)');
  },
});

/** GeoJSON Polygon stored as `geometry(Polygon,4326)`. */
export const polygon4326 = customType<{ data: GeoPolygon; driverData: string }>({
  dataType() {
    return `geometry(Polygon,${SRID})`;
  },
  toDriver(value: GeoPolygon): SQL {
    return sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(value)}), ${sql.raw(String(SRID))})`;
  },
  fromDriver(value: string): GeoPolygon {
    return parseGeoJson<GeoPolygon>(value, 'geometry(Polygon,4326)');
  },
});

/** GeoJSON LineString stored as `geometry(LineString,4326)`. */
export const lineString4326 = customType<{ data: GeoLineString; driverData: string }>({
  dataType() {
    return `geometry(LineString,${SRID})`;
  },
  toDriver(value: GeoLineString): SQL {
    return sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(value)}), ${sql.raw(String(SRID))})`;
  },
  fromDriver(value: string): GeoLineString {
    return parseGeoJson<GeoLineString>(value, 'geometry(LineString,4326)');
  },
});
