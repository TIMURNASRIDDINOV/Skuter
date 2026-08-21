import { describe, expect, it } from 'vitest';
import { haversineDistanceM, type LatLon } from '@ozothunder/shared';
import { mulberry32 } from '../seed/random.js';
import { generateStreetRoute, pickDestination, pickSpeedMps } from './paths.js';

const ORIGIN: LatLon = { lat: 41.3111, lon: 69.2797 };

function pathLength(route: readonly LatLon[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1];
    const b = route[i];
    if (a === undefined || b === undefined) continue;
    total += haversineDistanceM(a, b);
  }
  return total;
}

/**
 * Ratio of travelled distance to straight-line distance. A direct line is
 * exactly 1.0; a route that turns through a street grid is meaningfully above
 * it. This is the property that stops rides looking obviously fake on a map.
 */
function detourRatio(route: readonly LatLon[]): number {
  const first = route[0];
  const last = route.at(-1);
  if (first === undefined || last === undefined) return 1;
  const straight = haversineDistanceM(first, last);
  return straight === 0 ? 1 : pathLength(route) / straight;
}

/**
 * Number of significant heading changes along a route. This is the property
 * that actually matters: a scooter following streets turns corners. Detour
 * ratio alone is not sufficient — a trip due north is legitimately straight
 * under grid routing, so it has ratio 1.0 while still being a valid route.
 */
function turnCount(route: readonly LatLon[]): number {
  let turns = 0;
  let previousBearing: number | null = null;

  for (let i = 1; i < route.length; i += 1) {
    const a = route[i - 1];
    const b = route[i];
    if (a === undefined || b === undefined) continue;
    if (haversineDistanceM(a, b) < 1) continue;

    const bearing = Math.atan2(b.lat - a.lat, b.lon - a.lon);
    if (previousBearing !== null) {
      let delta = Math.abs(bearing - previousBearing);
      if (delta > Math.PI) delta = 2 * Math.PI - delta;
      if (delta > Math.PI / 8) turns += 1; // >22.5°
    }
    previousBearing = bearing;
  }
  return turns;
}

describe('generateStreetRoute', () => {
  it('turns corners instead of running straight to the destination', () => {
    const rng = mulberry32(99);
    const turns: number[] = [];

    for (let i = 0; i < 50; i += 1) {
      const destination = pickDestination(ORIGIN, rng);
      turns.push(turnCount(generateStreetRoute(ORIGIN, destination, rng)));
    }

    // Every route turns at least twice; the staircase uses 3–6 legs.
    expect(Math.min(...turns)).toBeGreaterThanOrEqual(2);
  });

  it('detours like a street grid on diagonal trips', () => {
    const rng = mulberry32(99);
    const ratios: number[] = [];

    for (let i = 0; i < 50; i += 1) {
      const destination = pickDestination(ORIGIN, rng);
      ratios.push(detourRatio(generateStreetRoute(ORIGIN, destination, rng)));
    }

    // Manhattan routing gives (|dx|+|dy|)/hypot, which averages ~1.27 over
    // uniform bearings and is 1.0 only for a trip due N/S/E/W.
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    expect(mean).toBeGreaterThan(1.15);
    expect(Math.max(...ratios)).toBeGreaterThan(1.3);
    // Nothing should exceed the Manhattan bound by more than the leg jitter.
    expect(Math.max(...ratios)).toBeLessThan(1.5);
  });

  it('arrives at the requested destination', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 20; i += 1) {
      const destination = pickDestination(ORIGIN, rng);
      const route = generateStreetRoute(ORIGIN, destination, rng);
      const last = route.at(-1);
      expect(last).toBeDefined();
      if (last !== undefined) {
        expect(haversineDistanceM(last, destination)).toBeLessThan(1);
      }
    }
  });

  it('densifies so the polyline animates smoothly', () => {
    const rng = mulberry32(3);
    const destination = pickDestination(ORIGIN, rng);
    const route = generateStreetRoute(ORIGIN, destination, rng);

    // ~20 m spacing; allow slack for the final partial step of each leg.
    for (let i = 1; i < route.length; i += 1) {
      const a = route[i - 1];
      const b = route[i];
      if (a === undefined || b === undefined) continue;
      expect(haversineDistanceM(a, b)).toBeLessThan(45);
    }
    expect(route.length).toBeGreaterThan(10);
  });

  it('always returns a valid LineString of at least two points', () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 20; i += 1) {
      const route = generateStreetRoute(ORIGIN, pickDestination(ORIGIN, rng), rng);
      expect(route.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('pickDestination', () => {
  it('stays within a plausible scooter trip distance', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 100; i += 1) {
      const distance = haversineDistanceM(ORIGIN, pickDestination(ORIGIN, rng));
      expect(distance).toBeGreaterThan(650);
      expect(distance).toBeLessThan(2600);
    }
  });
});

describe('pickSpeedMps', () => {
  it('is a realistic cruising speed', () => {
    const rng = mulberry32(13);
    for (let i = 0; i < 100; i += 1) {
      const speed = pickSpeedMps(rng);
      expect(speed).toBeGreaterThanOrEqual(4);
      expect(speed).toBeLessThanOrEqual(6);
    }
  });
});
