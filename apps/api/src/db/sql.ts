import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { GeoLineString, GeoPoint, GeoPolygon } from '@scoot/shared';

/**
 * Geometry select helpers. Postgres serialises a geometry column as WKB hex by
 * default, so every read of a geometry column goes through one of these and
 * comes back as parsed GeoJSON.
 */

export function selectPoint(column: PgColumn): SQL<GeoPoint> {
  return sql<GeoPoint>`ST_AsGeoJSON(${column})::json`;
}

export function selectPolygon(column: PgColumn): SQL<GeoPolygon> {
  return sql<GeoPolygon>`ST_AsGeoJSON(${column})::json`;
}

/** Nullable — `rides.path` is null until a ride has moved. */
export function selectLineString(column: PgColumn): SQL<GeoLineString | null> {
  return sql<GeoLineString | null>`ST_AsGeoJSON(${column})::json`;
}
