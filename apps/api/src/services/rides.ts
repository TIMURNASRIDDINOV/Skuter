import {
  API_ERROR_CODES,
  RIDEABLE_VEHICLE_STATUSES,
  type ActiveRide,
  type LatLon,
  type ParkingCheck,
  type Ride,
  type RideCostBreakdownPayload,
  type RideReceipt,
} from '@scoot/shared';
import { publishEvent } from '../events/bus.js';
import { getSimulationControl, getVehicleGateway } from '../gateway/index.js';
import { conflict, notFound } from '../lib/errors.js';
import type { Repositories } from '../repositories/index.js';
import { checkParking } from './parking.js';
import { releaseExpiredReservations, releaseVehicle } from './reservations.js';
import { elapsedSeconds, priceRide, settleRide } from './settlement.js';

/**
 * Ride lifecycle. This is the demo script's spine: scan, unlock, ride, fail to
 * park, park properly, receipt.
 */

export interface StartRideResult {
  ride: Ride;
  unlockLatencyMs: number;
}

/**
 * Scan-to-ride.
 *
 * The unlock command is sent **before** the ride is created: if the scooter
 * does not open, no ride exists and nobody is charged. That is also what makes
 * the app's optimistic UI safe to roll back — the server never half-committed.
 */
export async function startRide(
  repositories: Repositories,
  input: { userId: string; qrCode: string; planId: string },
): Promise<StartRideResult> {
  // First, so nothing below reads a vehicle still carrying a lapsed hold.
  await releaseExpiredReservations(repositories);

  const vehicle = await repositories.vehicles.findByQrCode(input.qrCode);
  if (vehicle === null) {
    throw notFound(`No scooter with code ${input.qrCode}`);
  }

  const plan = await repositories.plans.findById(input.planId);
  if (plan === null) throw notFound('No such plan');

  const existing = await repositories.rides.findActiveByUser(input.userId);
  if (existing !== null) {
    throw conflict(API_ERROR_CODES.RIDE_ALREADY_ACTIVE, 'You already have a ride in progress', {
      rideId: existing.id,
    });
  }

  // `reserved` is rideable — by whoever holds it. Without this check any rider
  // could scan a scooter somebody else is walking towards and take it.
  const hold = await repositories.vehicles.findHold(vehicle.id);
  if (hold !== null && hold.userId !== input.userId) {
    throw conflict(API_ERROR_CODES.VEHICLE_RESERVED, 'Another rider is holding this scooter', {
      until: hold.until.toISOString(),
    });
  }

  if (!RIDEABLE_VEHICLE_STATUSES.includes(vehicle.status)) {
    throw conflict(
      API_ERROR_CODES.VEHICLE_UNAVAILABLE,
      `This scooter is ${vehicle.status.replace('_', ' ')} and cannot be unlocked`,
      { status: vehicle.status },
    );
  }

  // A vehicle on somebody else's subscription is theirs, not available.
  const binding = await repositories.subscriptions.findActiveForVehicle(vehicle.id);
  if (binding !== null && binding.userId !== input.userId) {
    throw conflict(
      API_ERROR_CODES.VEHICLE_UNAVAILABLE,
      'This scooter is reserved on someone else’s subscription',
    );
  }

  const unlock = await getVehicleGateway().unlock(vehicle.id);
  publishEvent({
    type: 'command.updated',
    commandId: unlock.commandId,
    vehicleId: vehicle.id,
    commandType: 'unlock',
    status: unlock.status,
  });

  if (!unlock.ok) {
    // Expected roughly 8% of the time. Nothing was created, so the client
    // simply rolls its optimistic state back and offers a retry.
    throw conflict(
      API_ERROR_CODES.UNLOCK_FAILED,
      unlock.failureReason ?? 'The scooter did not respond',
      { commandId: unlock.commandId, retryable: true },
    );
  }

  const startedAt = new Date();
  const rideId = await repositories.rides.create({
    userId: input.userId,
    vehicleId: vehicle.id,
    planId: plan.id,
    startedAt,
  });

  // The hold has done its job. `silent` because `beginRide` below moves the
  // status to `in_use` — releasing loudly would flash the pin back to green
  // on the back office map for a beat first.
  await releaseVehicle(repositories, {
    userId: input.userId,
    vehicleId: vehicle.id,
    silent: true,
  });

  await repositories.vehicles.updateStatus(vehicle.id, 'in_use');
  // On simulated hardware this starts the vehicle moving. On real hardware
  // there is no equivalent — a person does the moving.
  await getSimulationControl()?.beginRide(vehicle.id, rideId);

  publishEvent({
    type: 'ride.started',
    rideId,
    userId: input.userId,
    vehicleId: vehicle.id,
  });

  const ride = await repositories.rides.findById(rideId);
  if (ride === null) throw new Error('Ride vanished immediately after creation');

  return { ride, unlockLatencyMs: unlock.latencyMs };
}

/** The rider's live ride, enriched for the active-ride screen. */
export async function getActiveRide(
  repositories: Repositories,
  userId: string,
): Promise<ActiveRide | null> {
  const ride = await repositories.rides.findActiveByUser(userId);
  if (ride === null) return null;

  const vehicle = await repositories.vehicles.findById(ride.vehicleId);
  if (vehicle === null) throw new Error(`Ride ${ride.id} references a missing vehicle`);

  const breakdown = await priceRide(repositories, ride, {
    durationS: elapsedSeconds(ride.startedAt),
    distanceM: ride.distanceM,
  });

  return {
    ...ride,
    planId: (await repositories.rides.findPlanId(ride.id)) ?? '',
    currentCost: breakdown.total,
    vehicle: {
      id: vehicle.id,
      qrCode: vehicle.qrCode,
      model: vehicle.model,
      batteryPct: vehicle.batteryPct,
      location: vehicle.location,
    },
  };
}

export interface EndRideOutcome {
  receipt: RideReceipt;
}

/**
 * End a ride at `location`.
 *
 * Refuses unless the rider is standing in a parking zone. The rejection is not
 * an error state to paper over — it is demo step 4, and it carries the nearest
 * legal zone and the walk to it.
 */
export async function endRide(
  repositories: Repositories,
  input: { userId: string; rideId: string; location: LatLon },
): Promise<EndRideOutcome> {
  const ride = await repositories.rides.findById(input.rideId);
  if (ride === null) throw notFound('No such ride');
  if (ride.userId !== input.userId) throw notFound('No such ride');
  if (ride.status !== 'active') {
    throw conflict(API_ERROR_CODES.CONFLICT, 'This ride has already ended');
  }

  const parking = await checkParking(repositories, input.location);
  if (!parking.allowed) {
    const code =
      parking.reason === 'inside_forbidden_zone'
        ? API_ERROR_CODES.INSIDE_FORBIDDEN_ZONE
        : parking.reason === 'outside_service_area'
          ? API_ERROR_CODES.OUTSIDE_SERVICE_AREA
          : API_ERROR_CODES.OUTSIDE_PARKING_ZONE;

    throw conflict(code, parkingMessage(parking.reason), { check: parking });
  }

  return endThroughGateway(repositories, ride, parking.zoneId);
}

/**
 * Operator force-end: settles the ride wherever the vehicle happens to be.
 * No parking check — this is the recovery path for stuck or abandoned rides,
 * and the operator is the authority. The rider is still charged for the time
 * used; `endZoneId` stays null because no legal zone was involved.
 */
export async function forceEndRide(
  repositories: Repositories,
  rideId: string,
): Promise<EndRideOutcome> {
  const ride = await repositories.rides.findById(rideId);
  if (ride === null) throw notFound('No such ride');
  if (ride.status !== 'active') {
    throw conflict(API_ERROR_CODES.CONFLICT, 'This ride has already ended');
  }

  return endThroughGateway(repositories, ride, null);
}

/**
 * Settle a ride a person ended. The motion comes from the gateway, which is
 * the half `settlement.ts` cannot reach without closing an import cycle.
 */
async function endThroughGateway(
  repositories: Repositories,
  ride: Ride,
  endZoneId: string | null,
): Promise<EndRideOutcome> {
  const finished = (await getSimulationControl()?.finishRide(ride.vehicleId)) ?? null;
  const { breakdown } = await settleRide(repositories, ride, { endZoneId, finished });
  return { receipt: await buildReceipt(repositories, ride.id, breakdown, endZoneId) };
}

export async function buildReceipt(
  repositories: Repositories,
  rideId: string,
  breakdown: RideCostBreakdownPayload,
  endZoneId: string | null,
): Promise<RideReceipt> {
  const ride = await repositories.rides.findById(rideId);
  if (ride === null) throw notFound('No such ride');

  const planId = await repositories.rides.findPlanId(rideId);
  const plan = planId === null ? null : await repositories.plans.findById(planId);
  const endZone = endZoneId === null ? null : await repositories.zones.findById(endZoneId);

  return {
    ride,
    breakdown,
    planName: plan?.name ?? 'Unknown plan',
    endZoneName: endZone?.name ?? null,
  };
}

// --- helpers -------------------------------------------------------------

/** Total over every reason — `ParkingCheck` is not discriminated on `allowed`. */
function parkingMessage(reason: ParkingCheck['reason']): string {
  switch (reason) {
    case 'outside_parking_zone':
      return 'You can only end a ride inside a parking zone';
    case 'inside_forbidden_zone':
      return 'Parking is not allowed here';
    case 'outside_service_area':
      return 'You are outside the service area';
    case 'ok':
      return 'Parking here is allowed';
  }
}


