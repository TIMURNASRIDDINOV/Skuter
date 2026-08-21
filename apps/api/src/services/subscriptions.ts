import {
  API_ERROR_CODES,
  type Subscription,
  type SubscriptionDetail,
} from '@ozothunder/shared';
import { publishEvent } from '../events/bus.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { getPaymentProvider } from '../payments/index.js';
import type { Repositories } from '../repositories/index.js';

/**
 * Subscriptions bind one rider to one specific vehicle for a fixed window.
 * While active, that vehicle is theirs — it leaves the public map and nobody
 * else can unlock it.
 */
export async function purchaseSubscription(
  repositories: Repositories,
  input: { userId: string; planId: string; vehicleId: string },
): Promise<{ subscription: Subscription }> {
  const plan = await repositories.plans.findById(input.planId);
  if (plan === null) throw notFound('No such plan');
  if (plan.durationDays === null) {
    throw badRequest('This plan is pay-as-you-go and cannot be subscribed to');
  }

  const vehicle = await repositories.vehicles.findById(input.vehicleId);
  if (vehicle === null) throw notFound('No such scooter');

  const existing = await repositories.subscriptions.findActiveForVehicle(input.vehicleId);
  if (existing !== null) {
    throw conflict(
      API_ERROR_CODES.VEHICLE_UNAVAILABLE,
      existing.userId === input.userId
        ? 'You already have an active subscription for this scooter'
        : 'This scooter is already on someone else’s subscription',
    );
  }

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

  const startsAt = new Date();
  const expiresAt = new Date(startsAt.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

  const subscription = await repositories.subscriptions.create({
    userId: input.userId,
    vehicleId: input.vehicleId,
    planId: plan.id,
    startsAt,
    expiresAt,
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

  // The vehicle is now reserved for this rider, which is what removes it from
  // the public map.
  await repositories.vehicles.updateStatus(input.vehicleId, 'reserved');

  publishEvent({
    type: 'subscription.created',
    subscriptionId: subscription.id,
    userId: input.userId,
    vehicleId: input.vehicleId,
    expiresAt: subscription.expiresAt,
  });

  publishEvent({
    type: 'vehicle.updated',
    vehicleId: vehicle.id,
    status: 'reserved',
    batteryPct: vehicle.batteryPct,
    location: vehicle.location,
  });

  return { subscription };
}

export async function listMySubscriptions(
  repositories: Repositories,
  userId: string,
): Promise<SubscriptionDetail[]> {
  return repositories.subscriptions.listForUser(userId);
}
