import { z } from 'zod';

/**
 * GeoJSON geometry schemas (RFC 7946), constrained to what this domain uses.
 * Coordinates are always [longitude, latitude] in EPSG:4326 — note the order,
 * it is the reverse of how coordinates are usually spoken.
 */

export const longitudeSchema = z.number().min(-180).max(180);
export const latitudeSchema = z.number().min(-90).max(90);

/** A single [lon, lat] pair. */
export const positionSchema = z.tuple([longitudeSchema, latitudeSchema]);
export type Position = z.infer<typeof positionSchema>;

export const geoPointSchema = z.object({
  type: z.literal('Point'),
  coordinates: positionSchema,
});
export type GeoPoint = z.infer<typeof geoPointSchema>;

export const geoLineStringSchema = z.object({
  type: z.literal('LineString'),
  // GeoJSON requires at least two positions for a LineString.
  coordinates: z.array(positionSchema).min(2),
});
export type GeoLineString = z.infer<typeof geoLineStringSchema>;

export const geoPolygonSchema = z.object({
  type: z.literal('Polygon'),
  // One or more linear rings; each ring is closed (first position === last)
  // and has at least 4 positions.
  coordinates: z.array(z.array(positionSchema).min(4)).min(1),
});
export type GeoPolygon = z.infer<typeof geoPolygonSchema>;

/** Plain lat/lon pair — the shape map SDKs and the client actually want. */
export const latLonSchema = z.object({
  lat: latitudeSchema,
  lon: longitudeSchema,
});
export type LatLon = z.infer<typeof latLonSchema>;

export function pointToLatLon(point: GeoPoint): LatLon {
  const [lon, lat] = point.coordinates;
  return { lat, lon };
}

export function latLonToPoint({ lat, lon }: LatLon): GeoPoint {
  return { type: 'Point', coordinates: [lon, lat] };
}

const EARTH_RADIUS_M = 6_371_008.8;

/**
 * Great-circle distance in metres (haversine). Used for client-side range and
 * walking-distance estimates; authoritative geo checks run in PostGIS.
 */
export function haversineDistanceM(a: LatLon, b: LatLon): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether a point falls inside a polygon, honouring interior rings (holes).
 *
 * Ray casting on the raw lon/lat plane. Like `haversineDistanceM` this is a
 * client-side approximation used to flag things in the UI — the authoritative
 * geofence checks run in PostGIS. At city scale the planar error is far below
 * the GPS noise the simulator already produces.
 */
export function isPointInPolygon(point: LatLon, polygon: GeoPolygon): boolean {
  const [outer, ...holes] = polygon.coordinates;
  if (outer === undefined) return false;
  if (!isInsideRing(point, outer)) return false;
  return !holes.some((hole) => isInsideRing(point, hole));
}

function isInsideRing(point: LatLon, ring: readonly Position[]): boolean {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const curr = ring[i];
    const prev = ring[j];
    if (curr === undefined || prev === undefined) continue;

    const [currLon, currLat] = curr;
    const [prevLon, prevLat] = prev;

    // Only edges that straddle the ray's latitude can cross it.
    if (currLat > point.lat === prevLat > point.lat) continue;

    const lonAtPointLat =
      ((prevLon - currLon) * (point.lat - currLat)) / (prevLat - currLat) + currLon;
    if (point.lon < lonAtPointLat) inside = !inside;
  }

  return inside;
}

/** Total length in metres of a GeoJSON LineString. */
export function lineStringLengthM(line: GeoLineString): number {
  let total = 0;
  for (let i = 1; i < line.coordinates.length; i += 1) {
    const prev = line.coordinates[i - 1];
    const curr = line.coordinates[i];
    if (prev === undefined || curr === undefined) continue;
    total += haversineDistanceM(
      { lon: prev[0], lat: prev[1] },
      { lon: curr[0], lat: curr[1] },
    );
  }
  return total;
}
