import type { Vehicle, Zone } from '@scoot/shared';
import { isPointInPolygon, VEHICLE_STATUS_SEVERITY } from '@scoot/shared';

/**
 * Which scooters a rider is allowed to see.
 *
 * The rule is the back office's severity axis, read from the rider's side —
 * see docs/parity-review.md §2.1:
 *
 *   alarm  → not shown at all
 *   watch  → shown, visually distinct, still rentable
 *   ok     → shown normally
 *
 * Most of it is already enforced upstream: `GET /vehicles` only returns
 * `available` and `low_battery`, so `offline`, `maintenance`, `in_use` and
 * `reserved` never arrive here. That leaves one alarm case for the client —
 * a scooter sitting outside every service zone, which the panel flags red and
 * which this app would otherwise offer as an ordinary rental.
 *
 * **This is advisory.** Hiding a pin is cosmetic: `POST /rides` does not check
 * service-area containment, so scanning that scooter's QR directly would still
 * start a ride. Same relationship the in-parking pill has with PostGIS — the
 * client hints, the server decides. Closing it needs an API change, tracked in
 * the parity review rather than faked with a block the server would not honour.
 */
export function isRentable(vehicle: Vehicle, serviceZones: readonly Zone[]): boolean {
  if (VEHICLE_STATUS_SEVERITY[vehicle.status] === 'alarm') return false;
  return isInServiceArea(vehicle, serviceZones);
}

/**
 * With no service zones loaded, every vehicle would read as outside one and
 * the map would empty itself. A transient fetch failure must not look like an
 * empty city, so absence of zones means "cannot judge", not "all stranded".
 */
export function isInServiceArea(vehicle: Vehicle, serviceZones: readonly Zone[]): boolean {
  if (serviceZones.length === 0) return true;
  return serviceZones.some((zone) => isPointInPolygon(vehicle.location, zone.geom));
}

export function serviceZonesOf(zones: readonly Zone[]): Zone[] {
  return zones.filter((zone) => zone.kind === 'service');
}

/** Severity as the rider app cares about it: is this one worth flagging? */
export function needsAttention(vehicle: Vehicle): boolean {
  return VEHICLE_STATUS_SEVERITY[vehicle.status] === 'watch';
}

/** Comfortable walking pace, m/s. Slower than the 1.4 m/s textbook figure. */
const WALK_SPEED_MPS = 1.25;

/** Typical shared-scooter speed in traffic, m/s (≈15 km/h). */
const RIDE_SPEED_MPS = 4.2;

/**
 * Minutes on foot to a scooter, always at least one.
 *
 * Straight-line, because the app has no routing service — a keyed one is the
 * kind of dependency this project deliberately avoids. Over the few hundred
 * metres this is ever shown for, street routing adds roughly a quarter, which
 * the deliberately slow pace above absorbs. Rounded up: "2 min" that takes
 * three is a worse lie than "3 min" that takes two.
 */
export function walkMinutes(distanceM: number): number {
  return Math.max(1, Math.ceil(distanceM / WALK_SPEED_MPS / 60));
}

/**
 * How long the remaining charge is good for, in minutes.
 *
 * `rangeM` is already the server's estimate from battery percentage; this only
 * restates it as time, which is what a rider actually decides on — "enough for
 * an hour" answers the question that "12 km" does not.
 */
export function rideMinutesLeft(vehicle: Vehicle): number {
  return Math.max(1, Math.round(vehicle.rangeM / RIDE_SPEED_MPS / 60));
}
