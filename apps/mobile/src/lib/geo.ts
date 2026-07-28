import type { GeoPolygon, LatLon } from '@scoot/shared';
import type { LatLng, Region } from 'react-native-maps';

/** Outer ring of a zone polygon as react-native-maps coordinates. */
export function polygonToLatLngs(polygon: GeoPolygon): LatLng[] {
  const ring = polygon.coordinates[0] ?? [];
  return ring.map(([longitude, latitude]) => ({ latitude, longitude }));
}

/**
 * Ray-cast point-in-polygon against the outer ring. Advisory only — the
 * "in parking zone" pill during a ride. The API's PostGIS check is the
 * authority on whether a ride may actually end.
 */
export function pointInPolygon(point: LatLon, polygon: GeoPolygon): boolean {
  const ring = polygon.coordinates[0] ?? [];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a === undefined || b === undefined) continue;
    const [ax, ay] = a;
    const [bx, by] = b;
    const intersects =
      ay > point.lat !== by > point.lat &&
      point.lon < ((bx - ax) * (point.lat - ay)) / (by - ay) + ax;
    if (intersects) inside = !inside;
  }
  return inside;
}

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

/** [west, south, east, north] for supercluster. */
export function regionToBBox(region: Region): [number, number, number, number] {
  return [
    region.longitude - region.longitudeDelta / 2,
    region.latitude - region.latitudeDelta / 2,
    region.longitude + region.longitudeDelta / 2,
    region.latitude + region.latitudeDelta / 2,
  ];
}

/** Web-mercator-ish zoom level from a region, for supercluster. */
export function regionToZoom(region: Region): number {
  return Math.round(Math.log2(360 / region.longitudeDelta));
}
