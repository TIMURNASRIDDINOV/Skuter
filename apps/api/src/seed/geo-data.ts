import type { GeoPolygon, LatLon } from '@scoot/shared';
import { polygonAround, polygonFromBounds } from './random.js';

/**
 * Fixed Tashkent geography for the demo. Hand-placed rather than generated, so
 * the zones sit on plausible real-world spots and stay put between seeds.
 */

/**
 * Service area — central Tashkent. Riding outside it is refused. Chosen to
 * comfortably contain all five vehicle clusters, from Sergeli in the south to
 * Yunusobod in the north.
 */
export const SERVICE_AREA: GeoPolygon = polygonFromBounds({
  west: 69.15,
  south: 41.19,
  east: 69.37,
  north: 41.39,
});

export interface SeedZone {
  name: string;
  centre: LatLon;
  radiusM: number;
}

/**
 * Five parking zones, one near each cluster so a rider always has somewhere
 * legal within walking distance. ~120 m across — big enough to stand in,
 * small enough that demo step 4 (ending a ride outside one) reliably fails.
 */
export const PARKING_ZONES: readonly SeedZone[] = [
  { name: 'Chilonzor metro — parking', centre: { lat: 41.2762, lon: 69.2049 }, radiusM: 120 },
  { name: 'Yunusobod bozor — parking', centre: { lat: 41.3608, lon: 69.2902 }, radiusM: 120 },
  { name: 'Mirzo Ulugbek — parking', centre: { lat: 41.3392, lon: 69.3339 }, radiusM: 120 },
  { name: 'Amir Temur square — parking', centre: { lat: 41.3125, lon: 69.2812 }, radiusM: 140 },
  { name: 'Sergeli metro — parking', centre: { lat: 41.2211, lon: 69.2214 }, radiusM: 120 },
] as const;

/**
 * One forbidden zone: the pedestrian stretch by Amir Temur square. Sits
 * deliberately close to a parking zone so the contrast is visible on the map.
 */
export const FORBIDDEN_ZONES: readonly SeedZone[] = [
  { name: 'Amir Temur skver — pedestrian only', centre: { lat: 41.3106, lon: 69.2779 }, radiusM: 180 },
] as const;

export interface SeedSlowZone extends SeedZone {
  speedLimitKph: number;
}

/**
 * Calmed areas — busy on foot, so the scooter throttles itself rather than
 * being refused outright.
 *
 * Deliberately large and overlapping the parking zones at Amir Temur and
 * Chilonzor: the rider has to *stand in one* for the speed-limit sheet to be
 * worth demonstrating, and the walk into parking (demo step 5) is the moment
 * they do. The Chorsu zone is the wide one, the two squares are the strict
 * ones, so the overlap also exercises the "lowest cap wins" ordering in
 * `findSlowZoneAt`.
 */
export const SLOW_ZONES: readonly SeedSlowZone[] = [
  {
    name: 'Amir Temur square — calmed',
    centre: { lat: 41.3122, lon: 69.2805 },
    radiusM: 320,
    speedLimitKph: 10,
  },
  {
    name: 'Chorsu bozor — calmed',
    centre: { lat: 41.3262, lon: 69.2352 },
    radiusM: 420,
    speedLimitKph: 15,
  },
  {
    name: 'Chilonzor metro — calmed',
    centre: { lat: 41.2766, lon: 69.2044 },
    radiusM: 300,
    speedLimitKph: 15,
  },
] as const;

export function zonePolygon(zone: SeedZone): GeoPolygon {
  return polygonAround(zone.centre, zone.radiusM, 10);
}

/**
 * Street-like segments per cluster. Part of each cluster is laid along these
 * rather than scattered radially, so pins line up the way parked scooters
 * actually do.
 */
export const CLUSTER_STREETS: Readonly<Record<string, { from: LatLon; to: LatLon }>> = {
  Chilonzor: {
    from: { lat: 41.2731, lon: 69.1995 },
    to: { lat: 41.2789, lon: 69.2087 },
  },
  Yunusobod: {
    from: { lat: 41.3567, lon: 69.2842 },
    to: { lat: 41.3641, lon: 69.2938 },
  },
  'Mirzo Ulugbek': {
    from: { lat: 41.3369, lon: 69.3298 },
    to: { lat: 41.3438, lon: 69.3401 },
  },
  'Amir Temur square': {
    from: { lat: 41.3079, lon: 69.2751 },
    to: { lat: 41.3148, lon: 69.2848 },
  },
  Sergeli: {
    from: { lat: 41.2172, lon: 69.2168 },
    to: { lat: 41.2233, lon: 69.2246 },
  },
};

/** Scooter models in the seeded fleet. */
export const VEHICLE_MODELS: readonly string[] = [
  'Ninebot Max G30',
  'Ninebot F40',
  'Xiaomi Pro 2',
  'Segway E45',
] as const;
