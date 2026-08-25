/** Display timezone. Everything is stored and transported as UTC. */
export const DISPLAY_TIMEZONE = 'Asia/Samarkand' as const;

/** Currency. Stored internally as integer tiyin; 1 so'm = 100 tiyin. */
export const CURRENCY_CODE = 'UZS' as const;
export const TIYIN_PER_SOM = 100 as const;

/**
 * Scooter models the back office offers when adding a vehicle.
 *
 * A suggestion list, not a constraint — the form accepts free text, because
 * the next crate to arrive will not ask this file first.
 */
export const VEHICLE_MODELS: readonly string[] = [
  'Ninebot Max G30',
  'Ninebot F40',
  'Xiaomi Pro 2',
  'Segway E45',
] as const;

/** Simulator tick interval (ms). */
export const SIMULATOR_TICK_MS = 3000 as const;

/**
 * Bukhara landmarks the demo revolves around — the old-town spots a fleet
 * would actually be parked near. The simulator routes between them and the
 * back office centres its map on them.
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

export const BUKHARA_CLUSTERS: readonly VehicleCluster[] = [
  { name: 'Poi Kalyan', lat: 39.7758, lon: 64.4136, radiusM: 800, weight: 0.24 },
  { name: 'Ark Fortress', lat: 39.7778, lon: 64.4108, radiusM: 800, weight: 0.2 },
  { name: 'Chor Minor', lat: 39.7717, lon: 64.4241, radiusM: 800, weight: 0.18 },
  { name: 'Lyab-i Hauz', lat: 39.7739, lon: 64.4213, radiusM: 800, weight: 0.24 },
  { name: 'Samani Park', lat: 39.7817, lon: 64.4297, radiusM: 800, weight: 0.14 },
] as const;

/** Initial map camera for the rider app — central Bukhara, whole fleet in frame. */
export const BUKHARA_MAP_CENTER = { lat: 39.7739, lon: 64.4213 } as const;
export const BUKHARA_MAP_DELTA = { latitudeDelta: 0.22, longitudeDelta: 0.22 } as const;

/**
 * How long a rider may hold a scooter before unlocking it.
 *
 * Free, and short on purpose: long enough to walk to the pin, short enough
 * that a hold cannot be used to take a scooter off the market. The hold is
 * released the moment the ride starts.
 */
export const RESERVATION_HOLD_MS = 10 * 60_000;

/** Battery percentage at or below which a vehicle counts as low battery. */
export const LOW_BATTERY_THRESHOLD_PCT = 20 as const;

/** Nominal range of a full battery, used for the "X km left" estimate. */
export const FULL_BATTERY_RANGE_M = 25_000 as const;

/** A vehicle is considered offline if telemetry stops for longer than this. */
export const VEHICLE_STALE_AFTER_MS = 60_000 as const;
