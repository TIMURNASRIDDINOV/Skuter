import { describe, expect, it } from 'vitest';
import { haversineDistanceM, type LatLon } from '@scoot/shared';
import { mulberry32, offsetMetres, polygonAround, scatterInDisc } from './random.js';
import { parseDurationSeconds } from '../lib/jwt.js';

const CHILONZOR: LatLon = { lat: 41.2756, lon: 69.2038 };

describe('seed randomness', () => {
  it('is deterministic for a given seed', () => {
    const a = Array.from({ length: 5 }, mulberry32(42));
    const b = Array.from({ length: 5 }, mulberry32(42));
    expect(a).toEqual(b);
  });

  it('produces different streams for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('keeps scattered vehicles inside the cluster radius', () => {
    const rng = mulberry32(20_260_728);
    for (let i = 0; i < 500; i += 1) {
      const point = scatterInDisc(CHILONZOR, 800, rng);
      // 1% tolerance for the flat-earth approximation in offsetMetres.
      expect(haversineDistanceM(CHILONZOR, point)).toBeLessThanOrEqual(808);
    }
  });

  it('does not bunch everything at the cluster centre', () => {
    const rng = mulberry32(7);
    const samples = Array.from({ length: 500 }, () => scatterInDisc(CHILONZOR, 800, rng));
    const nearCentre = samples.filter(
      (p) => haversineDistanceM(CHILONZOR, p) < 200,
    ).length;
    // Uniform-in-disc puts ~1/16 of points inside a quarter radius. A naive
    // (non-sqrt) sample would put ~1/4 there and look like a bullseye.
    expect(nearCentre / samples.length).toBeLessThan(0.12);
  });
});

describe('offsetMetres', () => {
  // Flat-earth approximation: a fixed 111 320 m/degree against haversine's true
  // earth radius. That is ~0.11% off — sub-metre over 500 m, which is far below
  // the precision that matters for placing a parked scooter.
  const TOLERANCE = 0.005;

  it('moves the requested distance north', () => {
    const moved = offsetMetres(CHILONZOR, 0, 500);
    expect(haversineDistanceM(CHILONZOR, moved)).toBeGreaterThan(500 * (1 - TOLERANCE));
    expect(haversineDistanceM(CHILONZOR, moved)).toBeLessThan(500 * (1 + TOLERANCE));
  });

  it('moves the requested distance east', () => {
    const moved = offsetMetres(CHILONZOR, 500, 0);
    expect(haversineDistanceM(CHILONZOR, moved)).toBeGreaterThan(500 * (1 - TOLERANCE));
    expect(haversineDistanceM(CHILONZOR, moved)).toBeLessThan(500 * (1 + TOLERANCE));
  });
});

describe('polygonAround', () => {
  it('produces a closed ring', () => {
    const polygon = polygonAround(CHILONZOR, 120, 10);
    const ring = polygon.coordinates[0];
    expect(ring).toBeDefined();
    expect(ring).toHaveLength(11); // 10 vertices + repeated first point
    expect(ring?.at(0)).toEqual(ring?.at(-1));
  });

  it('places vertices at the requested radius', () => {
    const polygon = polygonAround(CHILONZOR, 120, 8);
    const ring = polygon.coordinates[0] ?? [];
    for (const [lon, lat] of ring) {
      expect(haversineDistanceM(CHILONZOR, { lat, lon })).toBeCloseTo(120, -1);
    }
  });
});

describe('parseDurationSeconds', () => {
  it('parses each supported unit', () => {
    expect(parseDurationSeconds('90s')).toBe(90);
    expect(parseDurationSeconds('45m')).toBe(2700);
    expect(parseDurationSeconds('12h')).toBe(43_200);
    expect(parseDurationSeconds('30d')).toBe(2_592_000);
  });

  it('rejects malformed durations', () => {
    expect(() => parseDurationSeconds('30')).toThrow();
    expect(() => parseDurationSeconds('30w')).toThrow();
    expect(() => parseDurationSeconds('')).toThrow();
  });
});
