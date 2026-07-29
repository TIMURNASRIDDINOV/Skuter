import {
  API_ERROR_CODES,
  RIDEABLE_VEHICLE_STATUSES,
  calculateRideCost,
  lineStringLengthM,
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
import { getPaymentProvider } from '../payments/index.js';
import type { Repositories } from '../repositories/index.js';
import { checkParking } from './parking.js';

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
    planId: (await ridePlanId(repositories, ride.id)) ?? '',
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

  // Take the distance the vehicle actually travelled, rather than recomputing
  // from a path that is still being written.
  const finished = (await getSimulationControl()?.finishRide(ride.vehicleId)) ?? null;
  const distanceM = Math.round(
    finished?.distanceM ?? (ride.path === null ? ride.distanceM : lineStringLengthM(ride.path)),
  );
  const durationS = Math.round(elapsedSeconds(ride.startedAt));

  const breakdown = await priceRide(repositories, ride, { durationS, distanceM });

  if (breakdown.total > 0) {
    const charge = await getPaymentProvider().charge({
      userId: ride.userId,
      amount: breakdown.total,
      description: `Ride ${ride.id}`,
      rideId: ride.id,
    });
    await repositories.payments.record({
      userId: ride.userId,
      rideId: ride.id,
      subscriptionId: null,
      amount: breakdown.total,
      provider: getPaymentProvider().name,
      providerRef: charge.providerRef,
      status: charge.status,
    });
  }

  await repositories.rides.settle(ride.id, {
    endedAt: new Date(),
    distanceM,
    durationS,
    cost: breakdown.total,
    endZoneId: parking.zoneId,
    path: finished?.path ?? null,
  });

  await repositories.vehicles.updateStatus(ride.vehicleId, 'available');

  publishEvent({
    type: 'ride.ended',
    rideId: ride.id,
    userId: ride.userId,
    vehicleId: ride.vehicleId,
    status: 'completed',
    cost: breakdown.total,
    distanceM,
    durationS,
  });

  return { receipt: await buildReceipt(repositories, ride.id, breakdown, parking.zoneId) };
}

export async function buildReceipt(
  repositories: Repositories,
  rideId: string,
  breakdown: RideCostBreakdownPayload,
  endZoneId: string | null,
): Promise<RideReceipt> {
  const ride = await repositories.rides.findById(rideId);
  if (ride === null) throw notFound('No such ride');

  const planId = await ridePlanId(repositories, rideId);
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

function elapsedSeconds(startedAtIso: string): number {
  return (Date.now() - new Date(startedAtIso).getTime()) / 1000;
}

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

async function ridePlanId(repositories: Repositories, rideId: string): Promise<string | null> {
  return repositories.rides.findPlanId(rideId);
}

/**
 * Prices a ride through the one shared pure function, honouring an active
 * subscription binding the rider to this vehicle.
 */
async function priceRide(
  repositories: Repositories,
  ride: Ride,
  usage: { durationS: number; distanceM: number },
): Promise<RideCostBreakdownPayload> {
  const planId = await ridePlanId(repositories, ride.id);
  const plan = planId === null ? null : await repositories.plans.findById(planId);
  if (plan === null) {
    throw new Error(`Ride ${ride.id} has no resolvable plan`);
  }

  const subscription = await repositories.subscriptions.findActiveForUserAndVehicle(
    ride.userId,
    ride.vehicleId,
  );

  return calculateRideCost({
    plan: { kind: plan.kind, unlockFee: plan.unlockFee, price: plan.price },
    durationS: usage.durationS,
    distanceM: usage.distanceM,
    coveredBySubscription: subscription !== null || plan.kind !== 'per_minute',
  });
}
