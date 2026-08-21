import type { GeoPolygon, LatLon } from '@ozothunder/shared';

/**
 * Point-in-polygon deliberately does **not** live here. `isPointInPolygon` in
 * `@ozothunder/shared` is the one implementation, shared with the back office, and
 * it subtracts interior rings where the copy that used to sit in this file did
 * not. Two implementations of one domain predicate is what that package exists
 * to prevent — and the weaker one was deciding what the rider saw.
 *
 * Import it from `@ozothunder/shared` directly.
 */

/**
 * Vertex average of the outer ring (ignoring the closing point). Zones are
 * near-circular decagons, so this lands well inside — good enough for the
 * dev "step into zone" control.
 */
export function polygonCentroid(polygon: GeoPolygon): LatLon {
  const ring = polygon.coordinates[0] ?? [];
  const open = ring.length > 1 ? ring.slice(0, -1) : ring;
  if (open.length === 0) return { lat: 0, lon: 0 };
  let lat = 0;
  let lon = 0;
  for (const [x, y] of open) {
    lon += x;
    lat += y;
  }
  return { lat: lat / open.length, lon: lon / open.length };
}
