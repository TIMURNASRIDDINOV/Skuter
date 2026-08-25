import type { GeoPolygon, LatLon } from '@ozothunder/shared';
import { polygonAround, polygonFromBounds } from './random.js';

/**
 * Fixed Bukhara geography for the demo. Hand-placed rather than generated, so
 * the zones sit on plausible real-world spots and stay put between seeds.
 */

/**
 * Service area — central Bukhara. Riding outside it is refused. Chosen to
 * comfortably contain all five vehicle clusters, from Chor Minor in the east
 * to Ark Fortress in the west.
 */
export const SERVICE_AREA: GeoPolygon = polygonFromBounds({
  west: 64.3113,
  south: 39.6739,
  east: 64.5313,
  north: 39.8739,
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
  { name: 'Poi Kalyan — parking', centre: { lat: 39.7764, lon: 64.4147 }, radiusM: 120 },
  { name: 'Ark Fortress — parking', centre: { lat: 39.7784, lon: 64.4119 }, radiusM: 120 },
  { name: 'Chor Minor — parking', centre: { lat: 39.7711, lon: 64.423 }, radiusM: 120 },
  { name: 'Lyab-i Hauz — parking', centre: { lat: 39.7745, lon: 64.4224 }, radiusM: 140 },
  { name: 'Samani Park — parking', centre: { lat: 39.7811, lon: 64.4288 }, radiusM: 120 },
] as const;

/**
 * One forbidden zone: the pedestrian stretch by Toki Zargaron. Sits
 * deliberately close to a parking zone so the contrast is visible on the map.
 */
export const FORBIDDEN_ZONES: readonly SeedZone[] = [
  { name: 'Toki Zargaron — pedestrian only', centre: { lat: 39.7745, lon: 64.42 }, radiusM: 180 },
] as const;

export interface SeedSlowZone extends SeedZone {
  speedLimitKph: number;
}

/**
 * Calmed areas — busy on foot, so the scooter throttles itself rather than
 * being refused outright.
 *
 * Deliberately large and overlapping the parking zones at Lyab-i Hauz and
 * Poi Kalyan: the rider has to *stand in one* for the speed-limit sheet to be
 * worth demonstrating, and the walk into parking (demo step 5) is the moment
 * they do. The Toki Zargaron zone is the wide one, the other two are the
 * strict ones, so the overlap also exercises the "lowest cap wins" ordering in
 * `findSlowZoneAt`.
 */
export const SLOW_ZONES: readonly SeedSlowZone[] = [
  {
    name: 'Lyab-i Hauz — calmed',
    centre: { lat: 39.7742, lon: 64.421 },
    radiusM: 320,
    speedLimitKph: 10,
  },
  {
    name: 'Toki Zargaron bozor — calmed',
    centre: { lat: 39.7748, lon: 64.4195 },
    radiusM: 420,
    speedLimitKph: 15,
  },
  {
    name: 'Poi Kalyan — calmed',
    centre: { lat: 39.7762, lon: 64.414 },
    radiusM: 300,
    speedLimitKph: 15,
  },
] as const;

export function zonePolygon(zone: SeedZone): GeoPolygon {
  return polygonAround(zone.centre, zone.radiusM, 10);
}


