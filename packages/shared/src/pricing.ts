import { z } from 'zod';
import type { Tiyin } from './money.js';

/**
 * THE ride cost function. This module is the single implementation — the API
 * charges with it and the rider app tickers with it, so a receipt can never
 * disagree with what the phone showed during the ride.
 */

export const planKindSchema = z.enum(['per_minute', 'daily', 'weekly']);
export type PlanKind = z.infer<typeof planKindSchema>;

export const ridePricingPlanSchema = z.object({
  kind: planKindSchema,
  /** One-off fee charged at unlock, in tiyin. */
  unlockFee: z.int().nonnegative(),
  /**
   * For `per_minute`: the per-minute rate in tiyin.
   * For `daily`/`weekly`: the total price of the plan — it does not enter ride
   * cost, because rides under such a plan are already paid for.
   */
  price: z.int().nonnegative(),
});
export type RidePricingPlan = z.infer<typeof ridePricingPlanSchema>;

export const rideCostInputSchema = z.object({
  plan: ridePricingPlanSchema,
  /** Ride duration in seconds. Negative values are clamped to 0. */
  durationS: z.number(),
  /** Ride distance in metres. Carried into the breakdown for the receipt. */
  distanceM: z.number(),
  /**
   * Set when an active subscription binds this user to this vehicle. Defaults
   * to true for `daily`/`weekly` plans, which are subscriptions by definition.
   */
  coveredBySubscription: z.boolean().optional(),
});
export type RideCostInput = z.input<typeof rideCostInputSchema>;

export interface RideCostBreakdown {
  /** Unlock fee actually charged, in tiyin. */
  readonly unlockFee: Tiyin;
  /** Per-minute rate applied, in tiyin. */
  readonly ratePerMinute: Tiyin;
  /** Billable minutes — any started minute is charged in full. */
  readonly chargedMinutes: number;
  /** ratePerMinute * chargedMinutes, in tiyin. */
  readonly timeFee: Tiyin;
  /** Total charged for the ride, in tiyin. */
  readonly total: Tiyin;
  /** Echoed through for the receipt; does not affect the total. */
  readonly durationS: number;
  readonly distanceM: number;
  /** True when a subscription absorbed the cost, making the total 0. */
  readonly coveredBySubscription: boolean;
}

/**
 * Compute what a ride costs.
 *
 * Rules:
 * - A ride under an active subscription costs nothing — every component is 0.
 * - Otherwise: `unlockFee + ratePerMinute * ceil(durationS / 60)`.
 *   Any started minute is billed in full, which is the industry norm and what
 *   the receipt breakdown shows.
 * - Distance is recorded and displayed but is not billed in this pricing model.
 *
 * Pure: no clock, no I/O, no randomness. Same inputs, same output.
 *
 * @throws {RangeError} if durationS or distanceM is NaN or infinite.
 */
export function calculateRideCost(input: RideCostInput): RideCostBreakdown {
  const { plan, durationS, distanceM } = input;

  if (!Number.isFinite(durationS)) {
    throw new RangeError(`durationS must be a finite number, received ${String(durationS)}`);
  }
  if (!Number.isFinite(distanceM)) {
    throw new RangeError(`distanceM must be a finite number, received ${String(distanceM)}`);
  }

  // Clock skew on a device can briefly produce a negative elapsed time while
  // the ride timer is live. Clamp rather than throw, so the ticker never breaks.
  const safeDurationS = Math.max(0, durationS);
  const safeDistanceM = Math.max(0, distanceM);

  const coveredBySubscription = input.coveredBySubscription ?? plan.kind !== 'per_minute';

  if (coveredBySubscription) {
    return {
      unlockFee: 0,
      ratePerMinute: 0,
      chargedMinutes: 0,
      timeFee: 0,
      total: 0,
      durationS: safeDurationS,
      distanceM: safeDistanceM,
      coveredBySubscription: true,
    };
  }

  const ratePerMinute = plan.price;
  const chargedMinutes = Math.ceil(safeDurationS / 60);
  const timeFee = ratePerMinute * chargedMinutes;

  return {
    unlockFee: plan.unlockFee,
    ratePerMinute,
    chargedMinutes,
    timeFee,
    total: plan.unlockFee + timeFee,
    durationS: safeDurationS,
    distanceM: safeDistanceM,
    coveredBySubscription: false,
  };
}
