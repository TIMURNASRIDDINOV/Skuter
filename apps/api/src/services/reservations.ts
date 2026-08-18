import {
  API_ERROR_CODES,
  RESERVATION_HOLD_MS,
  type LatLon,
  type Vehicle,
  type VehicleStatus,
} from '@scoot/shared';
import { publishEvent } from '../events/bus.js';
import { getSimulationControl } from '../gateway/index.js';
import { conflict, notFound } from '../lib/errors.js';
import type { ReleasedVehicle } from '../repositories/vehicles.js';
import type { Repositories } from '../repositories/index.js';

/**
 * Reservation holds — a rider claims a scooter for `RESERVATION_HOLD_MS` while
 * they walk to it, and nobody else can unlock it in the meantime.
 *
 * A hold is two facts that must never disagree: the `reserved_until` /
 * `reserved_by` columns, and the vehicle's `reserved` status. The columns are
 * the truth (they say *whose* hold it is and when it lapses); the status is
 * what every existing screen already renders.
 *
 * **Nothing here decides anything from a SELECT issued after a write.** On
 * Cloudflare the database sits behind Hyperdrive, which caches read queries,
 * so a read-back can predate the write that preceded it. Built that way this
 * service misbehaved only in production: releases silently became no-ops and a
 * rider accumulated holds, while a cleared hold kept its `reserved` status.
 * Every branch below is driven by a RETURNING clause instead — see the note in
 * `repositories/vehicles.ts`.
 */

/**
 * Drop hardware identity. `findById` is the back-office read and carries IMEI;
 * everything this module hands back goes to a rider.
 */
function toPublic(vehicle: Vehicle & { imei: string }): Vehicle {
  const { imei: _imei, ...rest } = vehicle;
  return rest;
}

/**
 * Move a vehicle's status, through the gateway when one is simulating it.
 *
 * **This indirection is load-bearing.** The simulator keeps the fleet in
 * memory and flushes every vehicle's status to Postgres on each tick
 * (`gateway/simulated.ts`, `#tick`). A status written straight to the
 * repository is therefore correct for at most one tick before the simulator's
 * stale in-memory copy overwrites it — a hold placed at t=0 would silently
 * vanish at t=3s. `setStatus` updates both, which is why every other status
 * transition in this codebase (including `/dev/simulate/offline`) goes through
 * it. The repository fallback covers a real-hardware gateway, where no
 * in-memory fleet exists to disagree.
 */
async function moveStatus(
  repositories: Repositories,
  vehicleId: string,
  status: VehicleStatus,
): Promise<void> {
  const control = getSimulationControl();
  if (control === null) {
    await repositories.vehicles.updateStatus(vehicleId, status);
    return;
  }
  await control.setStatus(vehicleId, status);
}

/**
 * Announce a hold change so the back office redraws the pin without a refresh.
 *
 * Every field is supplied by the caller — the status because the caller just
 * set it, and battery and position because the statement that cleared or
 * claimed the hold already returned them. Reading any of it back would be both
 * a needless round-trip and exactly the cached-read hazard this module avoids.
 */
function announce(
  vehicle: { id: string; batteryPct: number; location: LatLon },
  status: VehicleStatus,
): void {
  publishEvent({
    type: 'vehicle.updated',
    vehicleId: vehicle.id,
    status,
    batteryPct: vehicle.batteryPct,
    location: vehicle.location,
  });
}

/** Put a released vehicle back on the map, if the hold was what held it there. */
async function restore(
  repositories: Repositories,
  released: ReleasedVehicle,
): Promise<void> {
  // Only a vehicle still sitting in `reserved` needs its status moved back.
  // One taken for maintenance, or unlocked, while held has already been moved
  // by whoever did that, and must not be dragged to `available`.
  if (released.status !== 'reserved') return;
  await moveStatus(repositories, released.id, 'available');
  announce(released, 'available');
}

/**
 * Release every hold whose time is up.
 *
 * Lazy rather than scheduled: it runs on the vehicle list and before a ride
 * starts, so a lapsed hold is always cleared before anything can observe it.
 * That keeps behaviour identical on Node and on Workers, where there is no
 * long-lived process to hang a timer on.
 *
 * One UPDATE clears the columns and reports which vehicles it touched; the
 * per-vehicle loop that follows only moves statuses, which has to go through
 * the gateway one at a time anyway.
 */
export async function releaseExpiredReservations(repositories: Repositories): Promise<number> {
  const released = await repositories.vehicles.clearLapsedHolds();
  for (const vehicle of released) {
    await restore(repositories, vehicle);
  }
  return released.length;
}

/**
 * Hold a scooter for this rider.
 *
 * Idempotent for the holder: tapping again on a scooter they already hold
 * extends nothing and errors on nothing. Two riders racing for the same
 * scooter are resolved by `claimHold`, which is a single conditional UPDATE —
 * exactly one of them matches a row.
 */
export async function reserveVehicle(
  repositories: Repositories,
  input: { userId: string; vehicleId: string },
): Promise<Vehicle> {
  await releaseExpiredReservations(repositories);

  const vehicle = await repositories.vehicles.findById(input.vehicleId);
  if (vehicle === null) throw notFound('No such scooter');

  if (vehicle.status !== 'available' && vehicle.status !== 'low_battery') {
    // `reserved` reaching here means somebody's live hold, including possibly
    // this rider's own — findHold distinguishes, and is a plain read with no
    // write before it in this request.
    const hold = await repositories.vehicles.findHold(input.vehicleId);
    if (hold !== null) {
      if (hold.userId === input.userId) {
        return { ...toPublic(vehicle), reservedUntil: hold.until.toISOString() };
      }
      throw conflict(API_ERROR_CODES.VEHICLE_RESERVED, 'Another rider is holding this scooter', {
        until: hold.until.toISOString(),
      });
    }
    throw conflict(
      API_ERROR_CODES.VEHICLE_UNAVAILABLE,
      `This scooter is ${vehicle.status.replace('_', ' ')} and cannot be held`,
      { status: vehicle.status },
    );
  }

  const binding = await repositories.subscriptions.findActiveForVehicle(vehicle.id);
  if (binding !== null && binding.userId !== input.userId) {
    throw conflict(
      API_ERROR_CODES.VEHICLE_UNAVAILABLE,
      'This scooter is reserved on someone else’s subscription',
    );
  }

  const until = new Date(Date.now() + RESERVATION_HOLD_MS);
  const claimed = await repositories.vehicles.claimHold(vehicle.id, input.userId, until);
  if (claimed === null) {
    throw conflict(API_ERROR_CODES.VEHICLE_RESERVED, 'Another rider got there first');
  }

  // Only once the claim is won, so a failed race leaves the rider's existing
  // hold alone.
  for (const other of await repositories.vehicles.clearOtherHoldsOf(input.userId, vehicle.id)) {
    await restore(repositories, other);
  }

  await moveStatus(repositories, vehicle.id, 'reserved');
  // `vehicle` was read before the claim; battery and position are cosmetic on
  // this event and cannot have moved meaningfully in between.
  announce(vehicle, 'reserved');

  // Built from what we just wrote, not read back.
  return { ...toPublic(vehicle), status: 'reserved', reservedUntil: until.toISOString() };
}

/**
 * Drop a hold this rider owns.
 *
 * `silent` skips the status move and the event, for the one caller that is
 * about to move the status itself — starting a ride, which sets `in_use`.
 * Announcing `available` on the way past would flash the pin green for a beat
 * on the back office map.
 */
export async function releaseVehicle(
  repositories: Repositories,
  input: { userId: string; vehicleId: string; silent?: boolean },
): Promise<void> {
  const released = await repositories.vehicles.clearHoldOwnedBy(input.vehicleId, input.userId);
  // No live hold, or somebody else's. Releasing something you do not hold is a
  // no-op rather than an error: the rider's intent — "I am not holding this" —
  // is already true, and the endpoint is idempotent.
  if (released === null) return;
  if (input.silent === true) return;

  await restore(repositories, released);
}

/** The rider's live hold, if they have one. Drives the countdown banner. */
export async function findActiveHold(
  repositories: Repositories,
  userId: string,
): Promise<{ vehicle: Vehicle; until: string } | null> {
  await releaseExpiredReservations(repositories);

  const held = await repositories.vehicles.findHeldBy(userId);
  if (held === null) return null;
  return { vehicle: held.vehicle, until: held.until.toISOString() };
}
