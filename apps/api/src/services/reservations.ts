import {
  API_ERROR_CODES,
  RESERVATION_HOLD_MS,
  type Vehicle,
  type VehicleStatus,
} from '@scoot/shared';
import { publishEvent } from '../events/bus.js';
import { getSimulationControl } from '../gateway/index.js';
import { conflict, notFound } from '../lib/errors.js';
import type { Repositories } from '../repositories/index.js';

/**
 * Reservation holds — a rider claims a scooter for `RESERVATION_HOLD_MS` while
 * they walk to it, and nobody else can unlock it in the meantime.
 *
 * A hold is two facts that must never disagree: the `reserved_until` /
 * `reserved_by` columns, and the vehicle's `reserved` status. The columns are
 * the truth (they say *whose* hold it is and when it lapses); the status is
 * what every existing screen already renders.
 */

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
 * Drop hardware identity. `findById` is the back-office read and carries IMEI;
 * everything this module hands back goes to a rider.
 */
function toPublic(vehicle: Vehicle & { imei: string }): Vehicle {
  const { imei: _imei, ...rest } = vehicle;
  return rest;
}

/** Announce a hold change so the back office redraws the pin without a refresh. */
async function announce(repositories: Repositories, vehicleId: string): Promise<void> {
  const vehicle = await repositories.vehicles.findById(vehicleId);
  if (vehicle === null) return;
  publishEvent({
    type: 'vehicle.updated',
    vehicleId,
    status: vehicle.status,
    batteryPct: vehicle.batteryPct,
    location: vehicle.location,
  });
}

/**
 * Release every hold whose time is up.
 *
 * Lazy rather than scheduled: it runs on the vehicle list and before a ride
 * starts, so a lapsed hold is always cleared before anything can observe it.
 * That keeps behaviour identical on Node and on Workers, where there is no
 * long-lived process to hang a timer on.
 *
 * Releases one vehicle at a time on purpose. A single bulk `UPDATE` would
 * clear the columns while leaving the simulator's in-memory copy on
 * `reserved`, and the next tick would write the expired hold straight back —
 * see `moveStatus`. The fleet is 70 vehicles and lapsed holds are rare, so the
 * loop costs nothing.
 */
export async function releaseExpiredReservations(repositories: Repositories): Promise<number> {
  const lapsed = await repositories.vehicles.findLapsedHolds();
  for (const vehicleId of lapsed) {
    await repositories.vehicles.clearHold(vehicleId);
    // Only a vehicle still sitting in `reserved` needs its status moved back.
    // One that was taken for maintenance, or unlocked, while held has already
    // been moved by whoever did that, and must not be dragged to `available`.
    const vehicle = await repositories.vehicles.findById(vehicleId);
    if (vehicle?.status === 'reserved') {
      await moveStatus(repositories, vehicleId, 'available');
      await announce(repositories, vehicleId);
    }
  }
  return lapsed.length;
}

/**
 * Hold a scooter for this rider.
 *
 * Idempotent for the holder: tapping again on a scooter they already hold
 * extends nothing and errors on nothing, it just returns the live hold. Two
 * riders racing for the same scooter are resolved by `claimHold`, which is a
 * single conditional UPDATE.
 */
export async function reserveVehicle(
  repositories: Repositories,
  input: { userId: string; vehicleId: string },
): Promise<Vehicle> {
  await releaseExpiredReservations(repositories);

  const vehicle = await repositories.vehicles.findById(input.vehicleId);
  if (vehicle === null) throw notFound('No such scooter');

  const existing = await repositories.vehicles.findHold(input.vehicleId);
  if (existing !== null) {
    if (existing.userId !== input.userId) {
      throw conflict(API_ERROR_CODES.VEHICLE_RESERVED, 'Another rider is holding this scooter', {
        until: existing.until.toISOString(),
      });
    }
    return toPublic(vehicle);
  }

  // A rider may hold one scooter at a time; a second hold releases the first.
  // Without this, walking past a nicer scooter and holding that one too takes
  // both off the map for ten minutes.
  await releaseHoldsOf(repositories, input.userId, input.vehicleId);

  if (vehicle.status !== 'available' && vehicle.status !== 'low_battery') {
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
  if (!claimed) {
    throw conflict(API_ERROR_CODES.VEHICLE_RESERVED, 'Another rider got there first');
  }

  await moveStatus(repositories, vehicle.id, 'reserved');
  await announce(repositories, vehicle.id);

  const updated = await repositories.vehicles.findById(vehicle.id);
  if (updated === null) throw notFound('No such scooter');
  return toPublic(updated);
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
  const hold = await repositories.vehicles.findHold(input.vehicleId);
  if (hold === null) return;
  if (hold.userId !== input.userId) {
    throw conflict(API_ERROR_CODES.VEHICLE_RESERVED, 'This hold belongs to another rider');
  }

  await repositories.vehicles.clearHold(input.vehicleId);
  if (input.silent === true) return;

  const vehicle = await repositories.vehicles.findById(input.vehicleId);
  if (vehicle?.status === 'reserved') {
    await moveStatus(repositories, input.vehicleId, 'available');
    await announce(repositories, input.vehicleId);
  }
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

/** Release whatever else this rider is holding, except `keepVehicleId`. */
async function releaseHoldsOf(
  repositories: Repositories,
  userId: string,
  keepVehicleId: string,
): Promise<void> {
  const held = await repositories.vehicles.findHeldBy(userId);
  if (held === null || held.vehicle.id === keepVehicleId) return;
  await releaseVehicle(repositories, { userId, vehicleId: held.vehicle.id });
}
