import type { LatLon, ParkingCheck } from '@ozothunder/shared';
import type { Repositories } from '../repositories/index.js';

/**
 * Where a ride may legally end.
 *
 * The authoritative check — the rider app runs its own optimistic version for
 * responsiveness, but this one decides. Order matters: a rider outside the
 * service area gets told that, not "no parking nearby", because the two need
 * different things from them.
 */
export async function checkParking(
  repositories: Repositories,
  location: LatLon,
): Promise<ParkingCheck> {
  const [insideService, forbidden, parking] = await Promise.all([
    repositories.zones.isInsideServiceArea(location),
    repositories.zones.findForbiddenZoneAt(location),
    repositories.zones.findParkingZoneAt(location),
  ]);

  // Parking is allowed only inside the service area, outside every forbidden
  // zone, and inside a parking zone.
  if (!insideService) {
    return withNearest(repositories, location, 'outside_service_area', null);
  }
  if (forbidden !== null) {
    return withNearest(repositories, location, 'inside_forbidden_zone', null);
  }
  if (parking === null) {
    return withNearest(repositories, location, 'outside_parking_zone', null);
  }

  return {
    allowed: true,
    reason: 'ok',
    zoneId: parking.id,
    nearestParkingZone: null,
  };
}

/**
 * Attaches the nearest parking zone and walking distance, which is what the
 * app renders on the "you can't park here" screen.
 */
async function withNearest(
  repositories: Repositories,
  location: LatLon,
  reason: Exclude<ParkingCheck['reason'], 'ok'>,
  zoneId: string | null,
): Promise<ParkingCheck> {
  const nearest = await repositories.zones.findNearestParkingZone(location);
  return {
    allowed: false,
    reason,
    zoneId,
    nearestParkingZone:
      nearest === null
        ? null
        : {
            id: nearest.id,
            name: nearest.name,
            distanceM: nearest.distanceM,
            geom: nearest.geom,
          },
  };
}
