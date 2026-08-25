import {
  API_ERROR_CODES,
  type CommandResult,
  type Rental,
  type Subscription,
  type SubscriptionDetail,
  type VehicleStatus,
} from '@ozothunder/shared';
import { publishEvent } from '../events/bus.js';
import { getSimulationControl, getVehicleGateway } from '../gateway/index.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { logError, logWarn } from '../lib/logger.js';
import { getPaymentProvider } from '../payments/index.js';
import type { Repositories } from '../repositories/index.js';

/**
 * Subscriptions bind one rider to one specific vehicle for a fixed window.
 * While active, that vehicle is theirs — it leaves the public map and nobody
 * else can unlock it.
 *
 * Two doors lead here and they are not interchangeable, but what separates
 * them is `plan.officeOnly`, **not** how long the rental runs:
 *
 * - Short rents — three hours, five, a day — are bought in the app through
 *   `purchaseSubscription`.
 * - A week or more is an agreement made at the office. The rider pays at the
 *   desk and an operator turns it on with `grantSubscription`; the app has no
 *   way to sell one, which is the whole point of the arrangement.
 *
 * Every one of them is a *rental*: the app gives up the map and becomes the
 * console in `app/(app)/rental.tsx`. A rental's on/off is a plain gateway
 * command — see `setRentalLock`. It creates no ride and costs nothing, so the
 * vehicle stays `reserved` for the entire window and the back-office map shows
 * it parked where it is.
 */

const MS_PER_MINUTE = 60 * 1000;

// --- buying and granting ---------------------------------------------------

export async function purchaseSubscription(
  repositories: Repositories,
  input: { userId: string; planId: string; vehicleId: string },
): Promise<{ subscription: Subscription }> {
  const plan = await repositories.plans.findById(input.planId);
  if (plan === null) throw notFound('No such plan');
  if (plan.durationMinutes === null) {
    throw badRequest('This plan is pay-as-you-go and cannot be subscribed to');
  }
  // A long rental is an agreement with a person at a desk, not a purchase. The
  // app never offers one (`GET /catalog/plans` drops office-only plans), so
  // reaching here means a stale client or a hand-rolled request.
  if (plan.officeOnly) {
    throw conflict(
      API_ERROR_CODES.OFFICE_ONLY_PLAN,
      'This rental is arranged at the office, not in the app',
    );
  }

  const vehicle = await requireFreeVehicle(repositories, input.vehicleId, input.userId);
  await requireNoActiveSubscription(repositories, input.userId);

  const charge = await getPaymentProvider().charge({
    userId: input.userId,
    amount: plan.price,
    description: `${plan.name} — ${vehicle.qrCode}`,
  });

  if (!charge.ok) {
    throw conflict(
      API_ERROR_CODES.PAYMENT_FAILED,
      charge.failureReason ?? 'Payment was declined',
    );
  }

  const subscription = await open(repositories, {
    userId: input.userId,
    vehicleId: input.vehicleId,
    planId: plan.id,
    durationMinutes: plan.durationMinutes,
  });

  await repositories.payments.record({
    userId: input.userId,
    rideId: null,
    subscriptionId: subscription.id,
    amount: plan.price,
    provider: getPaymentProvider().name,
    providerRef: charge.providerRef,
    status: charge.status,
  });

  return { subscription };
}

/**
 * The office path: an operator turns a rental on for a rider who has already
 * paid at the desk.
 *
 * Deliberately does **not** call the payment provider. The money was taken in
 * person, so what goes in `payments` is a ledger entry recording that — not a
 * charge against a wallet the rider never used.
 */
export async function grantSubscription(
  repositories: Repositories,
  input: {
    userId: string;
    vehicleId: string;
    planId: string;
    durationMinutes?: number | null;
  },
): Promise<{ subscription: Subscription }> {
  const rider = await repositories.users.findById(input.userId);
  if (rider === null) throw notFound('No such rider');
  if (rider.status !== 'active') {
    throw conflict(API_ERROR_CODES.CONFLICT, 'This account is blocked');
  }

  const plan = await repositories.plans.findById(input.planId);
  if (plan === null) throw notFound('No such plan');

  const durationMinutes = input.durationMinutes ?? plan.durationMinutes;
  if (durationMinutes === null) {
    throw badRequest('This plan is pay-as-you-go and has no rental period');
  }

  await requireNoActiveSubscription(repositories, input.userId);
  await requireFreeVehicle(repositories, input.vehicleId, input.userId);

  const subscription = await open(repositories, {
    userId: input.userId,
    vehicleId: input.vehicleId,
    planId: plan.id,
    durationMinutes,
  });

  await repositories.payments.record({
    userId: input.userId,
    rideId: null,
    subscriptionId: subscription.id,
    amount: plan.price,
    provider: 'mock',
    providerRef: `office_${subscription.id}`,
    status: 'succeeded',
  });

  return { subscription };
}

/** Common tail of both doors: create the row, take the vehicle off the map. */
async function open(
  repositories: Repositories,
  input: { userId: string; vehicleId: string; planId: string; durationMinutes: number },
): Promise<Subscription> {
  const startsAt = new Date();
  const expiresAt = new Date(startsAt.getTime() + input.durationMinutes * MS_PER_MINUTE);

  const subscription = await repositories.subscriptions.create({
    userId: input.userId,
    vehicleId: input.vehicleId,
    planId: input.planId,
    startsAt,
    expiresAt,
  });

  const vehicle = await setVehicleStatus(repositories, input.vehicleId, 'reserved');

  publishEvent({
    type: 'subscription.created',
    subscriptionId: subscription.id,
    userId: input.userId,
    vehicleId: input.vehicleId,
    expiresAt: subscription.expiresAt,
  });

  if (vehicle !== null) {
    publishEvent({
      type: 'vehicle.updated',
      vehicleId: vehicle.id,
      status: 'reserved',
      batteryPct: vehicle.batteryPct,
      location: vehicle.location,
    });
  }

  return subscription;
}

// --- ending ----------------------------------------------------------------

/** Operator ends a rental early — the rider brought the scooter back. */
export async function cancelSubscription(
  repositories: Repositories,
  subscriptionId: string,
): Promise<{ subscription: Subscription }> {
  const existing = await repositories.subscriptions.findById(subscriptionId);
  if (existing === null) throw notFound('No such subscription');

  const cancelled = await repositories.subscriptions.cancel(subscriptionId);
  if (cancelled === null) {
    throw conflict(API_ERROR_CODES.CONFLICT, 'This subscription has already ended');
  }

  await close(repositories, cancelled, 'cancelled');
  return { subscription: cancelled };
}

/**
 * Sweeps rentals whose window has closed and hands their scooters back.
 *
 * Lazy, like the reservation sweep it is modelled on: called at the top of the
 * rider's rental poll and of the back office's subscription list, so it needs
 * no scheduler and behaves the same on Node and on Workers.
 */
export async function expireLapsedSubscriptions(repositories: Repositories): Promise<number> {
  const lapsed = await repositories.subscriptions.expireLapsed();
  for (const subscription of lapsed) {
    await close(repositories, subscription, 'expired');
  }
  return lapsed.length;
}

/** Lock the scooter if it is on, return it to the fleet, announce both. */
async function close(
  repositories: Repositories,
  subscription: Subscription,
  reason: 'expired' | 'cancelled',
): Promise<void> {
  if (subscription.unlockedAt !== null) {
    // Best effort, and it has to actually be best effort: a scooter that does
    // not answer — or a gateway that is down entirely — must not keep an ended
    // rental open. The operator has the vehicle in front of them.
    try {
      const command = await getVehicleGateway().lock(subscription.vehicleId);
      publishEvent({
        type: 'command.updated',
        commandId: command.commandId,
        vehicleId: subscription.vehicleId,
        commandType: 'lock',
        status: command.status,
      });
    } catch (cause) {
      logWarn(
        `Could not lock vehicle ${subscription.vehicleId} while ending rental ` +
          `${subscription.id} (${describe(cause)}) — ending it anyway`,
      );
    }
    await repositories.subscriptions.setUnlocked(subscription.id, null);
  }

  const vehicle = await setVehicleStatus(repositories, subscription.vehicleId, 'available');

  publishEvent({
    type: 'subscription.ended',
    subscriptionId: subscription.id,
    userId: subscription.userId,
    vehicleId: subscription.vehicleId,
    reason,
  });

  if (vehicle !== null) {
    publishEvent({
      type: 'vehicle.updated',
      vehicleId: vehicle.id,
      status: 'available',
      batteryPct: vehicle.batteryPct,
      location: vehicle.location,
    });
  }
}

// --- the rider's rental ----------------------------------------------------

/**
 * Everything the rental console shows, or null when there is no rental.
 *
 * **Every active subscription is a rental**, whether it runs for three hours
 * or a fortnight and whether it was bought in the app or granted at the desk.
 * There used to be a second shape — a "daily pass" that left the rider on the
 * map with the scanner and the ride screen — and it is gone: renting a scooter
 * means the scooter is yours until the window closes.
 */
export async function getActiveRental(
  repositories: Repositories,
  userId: string,
): Promise<Rental | null> {
  const subscription = await repositories.subscriptions.findActiveForUser(userId);
  if (subscription === null) return null;

  const [plan, vehicle] = await Promise.all([
    repositories.plans.findById(subscription.planId),
    repositories.vehicles.findById(subscription.vehicleId),
  ]);
  if (plan === null || vehicle === null) return null;

  return {
    subscription,
    plan,
    vehicle: {
      id: vehicle.id,
      qrCode: vehicle.qrCode,
      model: vehicle.model,
      status: vehicle.status,
      batteryPct: vehicle.batteryPct,
      rangeM: vehicle.rangeM,
      location: vehicle.location,
    },
  };
}

/**
 * Switch the rented scooter on or off.
 *
 * No ride, no cost, no parking check: under a rental the rider is responsible
 * for where the scooter goes, which is exactly what they paid for. `unlockedAt` is written **after** the command acks, so a
 * scooter that did not answer never reads as on.
 */
export async function setRentalLock(
  repositories: Repositories,
  input: { userId: string; subscriptionId: string; unlocked: boolean },
): Promise<{ subscription: Subscription; command: CommandResult }> {
  const subscription = await requireOwnRental(repositories, input);

  const gateway = getVehicleGateway();
  const failureCode = input.unlocked
    ? API_ERROR_CODES.UNLOCK_FAILED
    : API_ERROR_CODES.LOCK_FAILED;

  // A gateway that throws is a different thing from a command that comes back
  // `ok: false`, but to the rider standing next to the scooter they are the
  // same event: it did not respond. Both become the retryable conflict the
  // slider already knows how to roll back from — never an opaque 500.
  let command: CommandResult;
  try {
    command = input.unlocked
      ? await gateway.unlock(subscription.vehicleId)
      : await gateway.lock(subscription.vehicleId);
  } catch (cause) {
    logError('Vehicle gateway unreachable while switching a rental', cause);
    throw conflict(failureCode, 'The scooter did not respond', { retryable: true });
  }

  publishEvent({
    type: 'command.updated',
    commandId: command.commandId,
    vehicleId: subscription.vehicleId,
    commandType: input.unlocked ? 'unlock' : 'lock',
    status: command.status,
  });

  if (!command.ok) {
    // Nothing was written, so the slider simply springs back and offers a
    // retry — the same contract as a failed unlock in `startRide`.
    throw conflict(failureCode, command.failureReason ?? 'The scooter did not respond', {
      commandId: command.commandId,
      retryable: true,
    });
  }

  const updated = await repositories.subscriptions.setUnlocked(
    subscription.id,
    input.unlocked ? new Date() : null,
  );
  if (updated === null) throw notFound('No such subscription');

  return { subscription: updated, command };
}

/** Make the rented scooter beep, so the rider can find it in a courtyard. */
export async function beepRental(
  repositories: Repositories,
  input: { userId: string; subscriptionId: string },
): Promise<CommandResult> {
  const subscription = await requireOwnRental(repositories, input);

  let command: CommandResult;
  try {
    command = await getVehicleGateway().beep(subscription.vehicleId);
  } catch (cause) {
    logError('Vehicle gateway unreachable while beeping a rental', cause);
    throw conflict(API_ERROR_CODES.CONFLICT, 'The scooter did not respond', { retryable: true });
  }

  publishEvent({
    type: 'command.updated',
    commandId: command.commandId,
    vehicleId: subscription.vehicleId,
    commandType: 'beep',
    status: command.status,
  });

  return command;
}

export async function listMySubscriptions(
  repositories: Repositories,
  userId: string,
): Promise<SubscriptionDetail[]> {
  return repositories.subscriptions.listForUser(userId);
}

// --- helpers ---------------------------------------------------------------

/** Error text for a log line, without assuming the throw was an Error. */
function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function requireOwnRental(
  repositories: Repositories,
  input: { userId: string; subscriptionId: string },
): Promise<Subscription> {
  const subscription = await repositories.subscriptions.findById(input.subscriptionId);
  // One message for "not yours" and "does not exist" — a rider must not be
  // able to probe for somebody else's rental ids.
  if (subscription === null || subscription.userId !== input.userId) {
    throw notFound('No such rental');
  }
  if (subscription.status !== 'active' || new Date(subscription.expiresAt) <= new Date()) {
    throw conflict(API_ERROR_CODES.NO_ACTIVE_RENTAL, 'This rental has ended');
  }

  return subscription;
}

async function requireNoActiveSubscription(
  repositories: Repositories,
  userId: string,
): Promise<void> {
  const existing = await repositories.subscriptions.findActiveForUser(userId);
  if (existing !== null) {
    throw conflict(
      API_ERROR_CODES.CONFLICT,
      'This rider already has an active rental — end it before starting another',
      { subscriptionId: existing.id },
    );
  }
}

async function requireFreeVehicle(
  repositories: Repositories,
  vehicleId: string,
  userId: string,
): Promise<{ id: string; qrCode: string }> {
  const vehicle = await repositories.vehicles.findById(vehicleId);
  if (vehicle === null) throw notFound('No such scooter');

  const existing = await repositories.subscriptions.findActiveForVehicle(vehicleId);
  if (existing !== null) {
    throw conflict(
      API_ERROR_CODES.VEHICLE_UNAVAILABLE,
      existing.userId === userId
        ? 'You already have an active subscription for this scooter'
        : 'This scooter is already on someone else’s subscription',
    );
  }

  const ride = await repositories.rides.findActiveByVehicle(vehicleId);
  if (ride !== null) {
    throw conflict(API_ERROR_CODES.VEHICLE_UNAVAILABLE, 'This scooter is out on a ride');
  }

  return vehicle;
}

/**
 * Status writes cross the gateway seam, never the repository — and they are
 * **best effort**.
 *
 * The seam first: the simulator holds the fleet in memory and flushes status
 * to Postgres every tick, so a status written straight to the database
 * survives at most 3 s before its stale copy overwrites it — the hazard
 * documented for reservation holds in `services/reservations.ts`.
 *
 * The best-effort part is the lesson from a live 500. On Workers the gateway
 * is a Durable Object, and a DO can be unreachable for reasons that have
 * nothing to do with this rental — an exhausted free-tier duration budget did
 * exactly that in production. `open()` had already committed the subscription
 * row by then, so the throw surfaced as "Something went wrong" over a rental
 * that had in fact been created.
 *
 * A vehicle's status is **not** what makes a rental real: the `subscriptions`
 * row is, and `listPublic` hides a subscribed vehicle by joining on that row
 * rather than by reading `status`. So this reports failure by returning null
 * and lets the caller carry on, rather than taking the rental down with it.
 */
async function setVehicleStatus(
  repositories: Repositories,
  vehicleId: string,
  status: VehicleStatus,
): Promise<{ id: string; batteryPct: number; location: { lat: number; lon: number } } | null> {
  const control = getSimulationControl();
  try {
    if (control === null) {
      await repositories.vehicles.updateStatus(vehicleId, status);
    } else {
      await control.setStatus(vehicleId, status);
    }
  } catch (cause) {
    // The gateway is down. Write it directly instead: a simulator that is not
    // running cannot overwrite us, and one that comes back will simply correct
    // a cosmetic status on its next tick.
    logWarn(
      `Vehicle ${vehicleId} status→${status} via gateway failed (${describe(cause)}), ` +
        'falling back to the database',
    );
    try {
      await repositories.vehicles.updateStatus(vehicleId, status);
    } catch (fallbackCause) {
      logError('Vehicle status write failed entirely', fallbackCause);
      return null;
    }
  }

  const vehicle = await repositories.vehicles.findById(vehicleId);
  return vehicle === null
    ? null
    : { id: vehicle.id, batteryPct: vehicle.batteryPct, location: vehicle.location };
}
