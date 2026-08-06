import { describe, expect, it } from 'vitest';
import { createZoneRequestSchema, updateZoneRequestSchema } from './zone.js';

/**
 * The speed limit and the zone kind have to agree. Both clients build their
 * forms around that rule, so it is worth pinning: a limit that survives on a
 * parking zone is a cap nothing will ever enforce, and a `slow` zone without
 * one has nothing to tell the rider.
 */

const geom = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [69.27, 41.31],
      [69.28, 41.31],
      [69.28, 41.32],
      [69.27, 41.32],
      [69.27, 41.31],
    ],
  ],
};

describe('createZoneRequestSchema', () => {
  it('accepts a slow zone carrying a limit', () => {
    const result = createZoneRequestSchema.safeParse({
      name: 'Amir Temur square — calmed',
      kind: 'slow',
      geom,
      speedLimitKph: 10,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a slow zone with no limit', () => {
    const result = createZoneRequestSchema.safeParse({
      name: 'Nameless calmed area',
      kind: 'slow',
      geom,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a limit on a kind that cannot enforce one', () => {
    const result = createZoneRequestSchema.safeParse({
      name: 'Chilonzor metro — parking',
      kind: 'parking',
      geom,
      speedLimitKph: 15,
    });
    expect(result.success).toBe(false);
  });

  it('accepts the other kinds with no limit', () => {
    for (const kind of ['service', 'parking', 'forbidden'] as const) {
      const result = createZoneRequestSchema.safeParse({ name: `A ${kind} zone`, kind, geom });
      expect(result.success).toBe(true);
    }
  });

  it('rejects a limit above what a scooter can do', () => {
    const result = createZoneRequestSchema.safeParse({
      name: 'Motorway',
      kind: 'slow',
      geom,
      speedLimitKph: 90,
    });
    expect(result.success).toBe(false);
  });
});

describe('updateZoneRequestSchema', () => {
  it('allows a rename without resending the kind', () => {
    // The pairing rule must not fire here: with no `kind` in the patch there
    // is nothing to check it against, and requiring one would make renaming a
    // slow zone impossible without also resending its limit.
    const result = updateZoneRequestSchema.safeParse({ name: 'Renamed' });
    expect(result.success).toBe(true);
  });

  it('enforces the pairing once the kind is part of the patch', () => {
    expect(updateZoneRequestSchema.safeParse({ kind: 'slow' }).success).toBe(false);
    expect(updateZoneRequestSchema.safeParse({ kind: 'slow', speedLimitKph: 15 }).success).toBe(
      true,
    );
    expect(updateZoneRequestSchema.safeParse({ kind: 'parking', speedLimitKph: 15 }).success).toBe(
      false,
    );
  });
});
