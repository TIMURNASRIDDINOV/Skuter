import { describe, expect, it } from 'vitest';
import { calculateRideCost, type RidePricingPlan } from './pricing.js';
import { formatSom, formatSomAmount, somToTiyin, tiyinToSom } from './money.js';

const perMinute: RidePricingPlan = {
  kind: 'per_minute',
  unlockFee: somToTiyin(3000), // 3 000 so'm
  price: somToTiyin(1000), // 1 000 so'm / minute
};

const rental: RidePricingPlan = {
  kind: 'rental',
  unlockFee: 0,
  price: somToTiyin(250_000),
};

describe('calculateRideCost — per-minute', () => {
  it('charges unlock fee plus whole started minutes', () => {
    const r = calculateRideCost({ plan: perMinute, durationS: 600, distanceM: 2400 });
    expect(r.chargedMinutes).toBe(10);
    expect(r.timeFee).toBe(somToTiyin(10_000));
    expect(r.unlockFee).toBe(somToTiyin(3000));
    expect(r.total).toBe(somToTiyin(13_000));
    expect(r.coveredBySubscription).toBe(false);
  });

  it('rounds any started minute up to a full minute', () => {
    expect(calculateRideCost({ plan: perMinute, durationS: 61, distanceM: 0 }).chargedMinutes).toBe(2);
    expect(calculateRideCost({ plan: perMinute, durationS: 1, distanceM: 0 }).chargedMinutes).toBe(1);
    expect(calculateRideCost({ plan: perMinute, durationS: 120, distanceM: 0 }).chargedMinutes).toBe(2);
  });

  it('charges only the unlock fee for a zero-length ride', () => {
    const r = calculateRideCost({ plan: perMinute, durationS: 0, distanceM: 0 });
    expect(r.chargedMinutes).toBe(0);
    expect(r.timeFee).toBe(0);
    expect(r.total).toBe(somToTiyin(3000));
  });

  it('clamps negative duration from device clock skew instead of throwing', () => {
    const r = calculateRideCost({ plan: perMinute, durationS: -5, distanceM: -10 });
    expect(r.durationS).toBe(0);
    expect(r.distanceM).toBe(0);
    expect(r.total).toBe(somToTiyin(3000));
  });

  it('carries distance into the breakdown without billing it', () => {
    const near = calculateRideCost({ plan: perMinute, durationS: 300, distanceM: 100 });
    const far = calculateRideCost({ plan: perMinute, durationS: 300, distanceM: 9000 });
    expect(near.total).toBe(far.total);
    expect(far.distanceM).toBe(9000);
  });

  it('rejects non-finite inputs', () => {
    expect(() => calculateRideCost({ plan: perMinute, durationS: Number.NaN, distanceM: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      calculateRideCost({ plan: perMinute, durationS: 0, distanceM: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
  });
});

describe('calculateRideCost — subscriptions', () => {
  it('treats a rental plan as fully covered', () => {
    const r = calculateRideCost({ plan: rental, durationS: 3600, distanceM: 12_000 });
    expect(r.total).toBe(0);
    expect(r.unlockFee).toBe(0);
    expect(r.timeFee).toBe(0);
    expect(r.coveredBySubscription).toBe(true);
    expect(r.durationS).toBe(3600);
    expect(r.distanceM).toBe(12_000);
  });

  it('zeroes a per-minute ride when an active subscription covers it', () => {
    const r = calculateRideCost({
      plan: perMinute,
      durationS: 1800,
      distanceM: 5000,
      coveredBySubscription: true,
    });
    expect(r.total).toBe(0);
    expect(r.coveredBySubscription).toBe(true);
  });

  it('allows an explicit override to bill under a subscription plan', () => {
    const r = calculateRideCost({
      plan: rental,
      durationS: 600,
      distanceM: 0,
      coveredBySubscription: false,
    });
    expect(r.coveredBySubscription).toBe(false);
    expect(r.total).toBe(rental.price * 10);
  });
});

describe('calculateRideCost — purity', () => {
  it('returns identical output for identical input', () => {
    const input = { plan: perMinute, durationS: 754, distanceM: 3120 } as const;
    expect(calculateRideCost(input)).toEqual(calculateRideCost(input));
  });
});

describe('money', () => {
  // The grouping separator is U+00A0 NO-BREAK SPACE, written as an escape so
  // these expectations cannot silently pass against a plain ASCII space.
  const NBSP = '\u00A0';
  const som = (grouped: string): string => `${grouped}${NBSP}so'm`;

  it('converts between som and tiyin', () => {
    expect(somToTiyin(12_500)).toBe(1_250_000);
    expect(tiyinToSom(1_250_000)).toBe(12_500);
  });

  it('formats tiyin as grouped som', () => {
    expect(formatSom(somToTiyin(12_500))).toBe(som(`12${NBSP}500`));
    expect(formatSom(somToTiyin(0))).toBe(som('0'));
    expect(formatSom(somToTiyin(999))).toBe(som('999'));
    expect(formatSom(somToTiyin(1_234_567))).toBe(som(`1${NBSP}234${NBSP}567`));
  });

  it('rounds sub-som tiyin for display only', () => {
    expect(formatSom(1250)).toBe(som('13'));
  });

  it('formats bare amounts without the currency suffix', () => {
    expect(formatSomAmount(somToTiyin(250_000))).toBe(`250${NBSP}000`);
  });

  it('keeps the sign on negative balances', () => {
    expect(formatSomAmount(somToTiyin(-4500))).toBe(`-4${NBSP}500`);
  });
});
