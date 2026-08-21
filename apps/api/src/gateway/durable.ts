import type { CommandResult, LatLon, ServerEvent, Telemetry, VehicleStatus } from '@ozothunder/shared';
import type {
  ManagedVehicleGateway,
  SimulationControl,
  SimulationSnapshot,
  Unsubscribe,
} from './types.js';

/**
 * Structural view of the FleetSimulator Durable Object's RPC surface. Kept
 * here (rather than importing the DO class) so the Node typecheck never needs
 * Cloudflare's type declarations — worker.ts casts the real stub to this.
 */
export interface FleetStub {
  unlock(vehicleId: string): Promise<CommandResult>;
  lock(vehicleId: string): Promise<CommandResult>;
  beep(vehicleId: string): Promise<CommandResult>;
  resetFleet(): Promise<{ vehicles: number }>;
  beginRide(vehicleId: string, rideId: string): Promise<void>;
  finishRide(vehicleId: string): Promise<{ distanceM: number; path: LatLon[] } | null>;
  forceRide(vehicleId: string): Promise<{ rideId: string; routePoints: number }>;
  drainBattery(vehicleId: string, toPct: number): Promise<{ batteryPct: number }>;
  setStatus(vehicleId: string, status: VehicleStatus): Promise<{ status: VehicleStatus }>;
  snapshot(): Promise<SimulationSnapshot>;
  publish(event: ServerEvent): Promise<void>;
}

/**
 * The Workers-side gateway: every call crosses the RPC boundary into the
 * FleetSimulator Durable Object, where a real SimulatedGateway runs. One
 * instance is created per request by worker.ts and carried in the runtime
 * context — the factory in index.ts prefers it over a local instance.
 */
export class DurableGateway implements ManagedVehicleGateway, SimulationControl {
  readonly #stub: FleetStub;

  constructor(stub: FleetStub) {
    this.#stub = stub;
  }

  // Lifecycle is the Durable Object's own (constructor + alarm); nothing to
  // do from the stateless Worker side.
  async start(): Promise<void> {
    /* no-op */
  }
  async stop(): Promise<void> {
    /* no-op */
  }

  unlock(vehicleId: string): Promise<CommandResult> {
    return this.#stub.unlock(vehicleId);
  }
  lock(vehicleId: string): Promise<CommandResult> {
    return this.#stub.lock(vehicleId);
  }
  beep(vehicleId: string): Promise<CommandResult> {
    return this.#stub.beep(vehicleId);
  }

  /**
   * Telemetry fan-out happens inside the DO (admin SSE attaches there
   * directly); nothing on the stateless Worker side ever subscribes.
   */
  subscribeTelemetry(_cb: (t: Telemetry) => void): Unsubscribe {
    return () => {};
  }

  resetFleet(): Promise<{ vehicles: number }> {
    return this.#stub.resetFleet();
  }
  beginRide(vehicleId: string, rideId: string): Promise<void> {
    return this.#stub.beginRide(vehicleId, rideId);
  }
  finishRide(vehicleId: string): Promise<{ distanceM: number; path: LatLon[] } | null> {
    return this.#stub.finishRide(vehicleId);
  }
  forceRide(vehicleId: string): Promise<{ rideId: string; routePoints: number }> {
    return this.#stub.forceRide(vehicleId);
  }
  drainBattery(vehicleId: string, toPct: number): Promise<{ batteryPct: number }> {
    return this.#stub.drainBattery(vehicleId, toPct);
  }
  setStatus(vehicleId: string, status: VehicleStatus): Promise<{ status: VehicleStatus }> {
    return this.#stub.setStatus(vehicleId, status);
  }
  snapshot(): Promise<SimulationSnapshot> {
    return this.#stub.snapshot();
  }
}
