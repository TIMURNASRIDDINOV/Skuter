import type { GeoPolygon, LatLon, VehicleStatus, ZoneKind } from '@scoot/shared';
import { TASHKENT_MAP_CENTER } from '@scoot/shared';

/** Same OpenFreeMap style the native app uses (apps/mobile/src/lib/map.ts). */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export const MAP_CENTER: [number, number] = [TASHKENT_MAP_CENTER.lon, TASHKENT_MAP_CENTER.lat];

/**
 * Colours mirror apps/mobile/src/lib/theme.ts and the admin's status.tsx —
 * a colour never means two things across the apps.
 */
export const VEHICLE_STATUS_COLOUR: Record<VehicleStatus, string> = {
  available: '#52C41A',
  in_use: '#1677FF',
  reserved: '#722ED1',
  low_battery: '#FAAD14',
  offline: '#8C8C8C',
  maintenance: '#F5222D',
};

export const ZONE_KIND_COLOUR: Record<ZoneKind, string> = {
  service: '#1677FF',
  parking: '#52C41A',
  forbidden: '#F5222D',
  slow: '#FA8C16',
};

export const DEMO_CONTROLS_ENABLED: boolean = import.meta.env['VITE_DEMO_CONTROLS'] === '1';

/** Copy of apps/mobile/src/lib/geo.ts — advisory only, PostGIS decides. */
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

export function formatDuration(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${m}:${String(rest).padStart(2, '0')}`;
}

export function formatDistance(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(1).replace('.', ',')} км`;
  return `${Math.round(metres)} м`;
}

export function haversineM(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
