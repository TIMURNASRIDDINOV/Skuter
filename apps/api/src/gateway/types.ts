import type { CommandResult, LatLon, Telemetry, VehicleStatus } from '@scoot/shared';

/** Returned by `subscribeTelemetry`; calling it detaches the listener. */
export type Unsubscribe = () => void;

/**
 * The seam between this application and scooter hardware.
 *
 * Two implementations exist: `SimulatedGateway` (active now) and `IotGateway`
 * (phase 2, MQTT to real controllers). **Nothing outside `src/gateway/` may
 * know which one is live** — everything else resolves a gateway through
 * `getVehicleGateway()` and programs against this interface only.
 */
export interface VehicleGateway {
  unlock(vehicleId: string): Promise<CommandResult>;
  lock(vehicleId: string): Promise<CommandResult>;
  beep(vehicleId: string): Promise<CommandResult>;
  subscribeTelemetry(cb: (t: Telemetry) => void): Unsubscribe;
}

/** Start/stop lifecycle, handled inside the gateway module by the factory. */
export interface ManagedVehicleGateway extends VehicleGateway {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Demo controls for driving fleet state from the outside — reset, force a
 * ride, drain a battery, take a vehicle offline.
 *
 * Only a simulated fleet can offer these. `getSimulationControl()` returns null
 * when the active gateway is real hardware, and the /dev/simulate/* routes
 * answer 501 in that case rather than pretending.
 */
export interface SimulationControl {
  /** Reload fleet state from the database, discarding in-memory drift. */
  resetFleet(): Promise<{ vehicles: number }>;
  /**
   * Attach an already-created ride to a vehicle so it starts moving along a
   * generated route. Called when a real rider starts a ride — on real hardware
   * this has no equivalent, because a person does the moving.
   *
   * Async because on Cloudflare these cross a Durable Object RPC boundary.
   */
  beginRide(vehicleId: string, rideId: string): Promise<void>;
  /**
   * Detach a ride and report the distance travelled, so the ride settles
   * against what the vehicle actually did rather than a recomputed guess.
   */
  finishRide(vehicleId: string): Promise<{ distanceM: number; path: LatLon[] } | null>;
  /** Put a vehicle on a generated street route as an active ride. */
  forceRide(vehicleId: string): Promise<{ rideId: string; routePoints: number }>;
  /** Drop a vehicle's battery to a given percentage. */
  drainBattery(vehicleId: string, toPct: number): Promise<{ batteryPct: number }>;
  /** Force a vehicle into a status, e.g. `offline`. */
  setStatus(vehicleId: string, status: VehicleStatus): Promise<{ status: VehicleStatus }>;
  /** Current in-memory snapshot, for the dev endpoints to report. */
  snapshot(): Promise<SimulationSnapshot>;
}

export interface SimulationSnapshot {
  running: boolean;
  tickMs: number;
  ticks: number;
  vehicles: number;
  activeRides: number;
  lastTickAt: string | null;
}

/** In-memory state the simulator keeps for one vehicle. */
export interface SimulatedVehicle {
  id: string;
  qrCode: string;
  status: VehicleStatus;
  /** Kept as a float so slow drain is not lost to integer rounding. */
  batteryPct: number;
  position: LatLon;
  /** Anchor a parked vehicle drifts around, so it never wanders off. */
  anchor: LatLon;
  ride: SimulatedRide | null;
  /**
   * What Postgres was last told about this vehicle. The tick compares against
   * these to skip writing rows that have not materially changed — a parked
   * scooter at the drain floor otherwise rewrites the same battery and 2 m of
   * GPS jitter every 3 seconds, forever. Null until the first flush.
   */
  flushedStatus: VehicleStatus | null;
  flushedBatteryPct: number | null;
}

export interface SimulatedRide {
  rideId: string;
  /**
   * Whether the simulator may end this ride itself.
   *
   * True only for rides the simulator started under a reserved simulator
   * account. **A real rider's ride is never auto-finished** — ending it from a
   * timer would settle and charge somebody mid-demo — so `beginRide` builds
   * these false and only an explicit end-ride or an operator force-end closes
   * them.
   */
  autoFinish: boolean;
  /**
   * Street legs left before an auto-finishing ride settles. Meaningless when
   * `autoFinish` is false, where a route that runs out is simply extended.
   */
  legsRemaining: number;
  /** Set when the last leg is spent; the next tick settles and clears it. */
  spent: boolean;
  /** Densified street-like polyline the vehicle follows. */
  route: LatLon[];
  /** Index of the next route point to reach. */
  cursor: number;
  /** Metres per second along the route. */
  speedMps: number;
  /** Points travelled so far, accumulated into rides.path. */
  travelled: LatLon[];
  distanceM: number;
  startedAt: Date;
}
