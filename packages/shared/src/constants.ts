/** Display timezone. Everything is stored and transported as UTC. */
export const DISPLAY_TIMEZONE = 'Asia/Tashkent' as const;

/** Currency. Stored internally as integer tiyin; 1 so'm = 100 tiyin. */
export const CURRENCY_CODE = 'UZS' as const;
export const TIYIN_PER_SOM = 100 as const;

/** Fleet size seeded for the demo. */
export const FLEET_SIZE = 70 as const;

/** Simulator tick interval (ms). */
export const SIMULATOR_TICK_MS = 3000 as const;

/**
 * Seeded vehicle clusters — real Tashkent geography. Vehicles scatter within
 * `radiusM` of each centre rather than on a grid, so the map reads as a real
 * fleet parked near metro stations and residential blocks.
 */
export interface VehicleCluster {
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  /** Scatter radius in metres. */
  readonly radiusM: number;
  /** Share of the fleet parked here. Weights across all clusters sum to 1. */
  readonly weight: number;
}

export const TASHKENT_CLUSTERS: readonly VehicleCluster[] = [
  { name: 'Chilonzor', lat: 41.2756, lon: 69.2038, radiusM: 800, weight: 0.24 },
  { name: 'Yunusobod', lat: 41.36, lon: 69.289, radiusM: 800, weight: 0.2 },
  { name: 'Mirzo Ulugbek', lat: 41.34, lon: 69.335, radiusM: 800, weight: 0.18 },
  { name: 'Amir Temur square', lat: 41.3111, lon: 69.2797, radiusM: 800, weight: 0.24 },
  { name: 'Sergeli', lat: 41.22, lon: 69.22, radiusM: 800, weight: 0.14 },
] as const;

/** Initial map camera for the rider app — central Tashkent, whole fleet in frame. */
export const TASHKENT_MAP_CENTER = { lat: 41.3111, lon: 69.2797 } as const;
export const TASHKENT_MAP_DELTA = { latitudeDelta: 0.22, longitudeDelta: 0.22 } as const;

/** Battery percentage at or below which a vehicle counts as low battery. */
export const LOW_BATTERY_THRESHOLD_PCT = 20 as const;

/** Nominal range of a full battery, used for the "X km left" estimate. */
export const FULL_BATTERY_RANGE_M = 25_000 as const;

/** A vehicle is considered offline if telemetry stops for longer than this. */
export const VEHICLE_STALE_AFTER_MS = 60_000 as const;
