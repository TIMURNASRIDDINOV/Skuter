import {
  calculateRideCost,
  lineStringLengthM,
  type LatLon,
  type Ride,
  type RideCostBreakdownPayload,
} from '@ozothunder/shared';
import { publishEvent } from '../events/bus.js';
import { getPaymentProvider } from '../payments/index.js';
import type { Repositories } from '../repositories/index.js';

/**
 * The one ride settlement pipeline — charge, persist, free the vehicle, notify.
 *
 * **Deliberately knows nothing about `gateway/`.** Two callers need it and they
 * sit on opposite sides of that seam: `services/rides.ts` settles when a rider
 * or an operator ends a ride, and `gateway/simulated.ts` settles when a demo
 * ride runs out of legs. If this lived in `services/rides.ts` the simulator
 * could not reach it — that module imports the gateway factory, so the
 * simulator importing it back would close a cycle.
 *
 * The motion a ride actually performed is therefore passed in rather than
 * fetched from the gateway. The service asks `finishRide()` for it; the
 * simulator already has it in hand.
 */

export interface FinishedMotion {
  distanceM: number;
  path: LatLon[];
}

export function elapsedSeconds(startedAtIso: string): number {
  return (Date.now() - new Date(startedAtIso).getTime()) / 1000;
}

/**
 * Prices a ride through the one shared pure function, honouring an active
 * subscription binding the rider to this vehicle.
 */
export async function priceRide(
  repositories: Repositories,
  ride: Ride,
  usage: { durationS: number; distanceM: number },
): Promise<RideCostBreakdownPayload> {
  const planId = await repositories.rides.findPlanId(ride.id);
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

export interface SettledRide {
  breakdown: RideCostBreakdownPayload;
  distanceM: number;
  durationS: number;
}

export async function settleRide(
  repositories: Repositories,
  ride: Ride,
  input: { endZoneId: string | null; finished: FinishedMotion | null },
): Promise<SettledRide> {
  // Prefer the distance the vehicle actually travelled over recomputing from a
  // path that may still be being written.
  const distanceM = Math.round(
    input.finished?.distanceM ??
      (ride.path === null ? ride.distanceM : lineStringLengthM(ride.path)),
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
    endZoneId: input.endZoneId,
    path: input.finished?.path ?? null,
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

  return { breakdown, distanceM, durationS };
}
