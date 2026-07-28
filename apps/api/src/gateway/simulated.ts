import {
  LOW_BATTERY_THRESHOLD_PCT,
  calculateRideCost,
  haversineDistanceM,
  type CommandResult,
  type CommandType,
  type LatLon,
  type Telemetry,
  type VehicleStatus,
} from '@scoot/shared';
import { env } from '../env.js';
import { publishEvent } from '../events/bus.js';
import { logError, logInfo } from '../lib/logger.js';
import type { Repositories } from '../repositories/index.js';
import { mulberry32, offsetMetres, type Rng } from '../seed/random.js';
import { isSimulatorRider } from '../seed/riders.js';
import { generateStreetRoute, pickDestination, pickSpeedMps } from '../simulator/paths.js';
import type {
  ManagedVehicleGateway,
  SimulatedRide,
  SimulatedVehicle,
  SimulationControl,
  SimulationSnapshot,
  Unsubscribe,
} from './types.js';

/**
 * A simulated scooter fleet that behaves enough like real hardware to demo on.
 *
 * Holds fleet state in memory, advances it on a fixed tick, and pushes
 * telemetry to subscribers. Positions and batteries are flushed to Postgres in
 * one batched statement per tick.
 */

/**
 * Drain rates are **demo-compressed**: tuned so a viewer sees battery move
 * within ~30 seconds. A real scooter drains orders of magnitude slower.
 */
const IDLE_DRAIN_PCT_PER_TICK = 0.08;
const RIDING_DRAIN_PCT_PER_TICK = 0.45;

/**
 * Parked vehicles stop draining here, so the fleet survives a long meeting.
 * Without a floor, compressed idle drain flattens all 70 vehicles in about
 * 40 minutes and the map empties out mid-demo. Stands in for the battery-swap
 * crew a real operator runs, which is explicitly out of scope.
 *
 * Vehicles seeded below the floor (the low-battery six) stay where they are —
 * the floor stops drain, it does not charge anything.
 */
const IDLE_DRAIN_FLOOR_PCT = 30;

/** How far a parked vehicle may drift from its anchor — GPS jitter, in metres. */
const IDLE_DRIFT_RADIUS_M = 8;
const IDLE_DRIFT_STEP_M = 2.5;

/** Unlock round-trip, matching a real cellular controller's latency. */
const UNLOCK_MIN_MS = 1200;
const UNLOCK_MAX_MS = 2000;
/** Lock and beep are cheaper operations on real hardware, and near-reliable. */
const FAST_COMMAND_MIN_MS = 300;
const FAST_COMMAND_MAX_MS = 700;
const FAST_COMMAND_FAILURE_RATE = 0.01;

const UNLOCK_FAILURE_REASONS = [
  'Scooter did not acknowledge the unlock command',
  'Controller timed out — weak cellular signal',
  'Lock actuator reported a fault',
] as const;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SimulatedGateway implements ManagedVehicleGateway, SimulationControl {
  readonly #repositories: Repositories;
  readonly #rng: Rng = mulberry32(0x5c007);
  readonly #fleet = new Map<string, SimulatedVehicle>();
  readonly #listeners = new Set<(t: Telemetry) => void>();

  #timer: NodeJS.Timeout | null = null;
  #ticks = 0;
  #lastTickAt: Date | null = null;
  #ticking = false;
  /** Cached so the live cost ticker does not hit the database every tick. */
  #perMinutePlan: { unlockFee: number; price: number } | null = null;

  constructor(repositories: Repositories) {
    this.#repositories = repositories;
  }

  // --- lifecycle ---------------------------------------------------------

  async start(): Promise<void> {
    if (this.#timer !== null) return;

    await this.#loadFleet();
    await this.#cachePricing();
    await this.#reconcileActiveRides();

    this.#timer = setInterval(() => {
      // Ticks are async; never let one overlap the next.
      if (this.#ticking) return;
      this.#ticking = true;
      void this.#tick()
        .catch((error: unknown) => {
          logError('Simulator tick failed', error);
        })
        .finally(() => {
          this.#ticking = false;
        });
    }, env.SIMULATOR_TICK_MS);

    logInfo(
      `Simulator started — ${this.#fleet.size} vehicles, tick ${env.SIMULATOR_TICK_MS}ms, ` +
        `unlock failure rate ${(env.SIMULATOR_UNLOCK_FAILURE_RATE * 100).toFixed(0)}%`,
    );
  }

  async stop(): Promise<void> {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#listeners.clear();
    await Promise.resolve();
  }

  // --- VehicleGateway ----------------------------------------------------

  async unlock(vehicleId: string): Promise<CommandResult> {
    return this.#dispatch(vehicleId, 'unlock', {
      minMs: UNLOCK_MIN_MS,
      maxMs: UNLOCK_MAX_MS,
      failureRate: env.SIMULATOR_UNLOCK_FAILURE_RATE,
    });
  }

  async lock(vehicleId: string): Promise<CommandResult> {
    return this.#dispatch(vehicleId, 'lock', {
      minMs: FAST_COMMAND_MIN_MS,
      maxMs: FAST_COMMAND_MAX_MS,
      failureRate: FAST_COMMAND_FAILURE_RATE,
    });
  }

  async beep(vehicleId: string): Promise<CommandResult> {
    return this.#dispatch(vehicleId, 'beep', {
      minMs: FAST_COMMAND_MIN_MS,
      maxMs: FAST_COMMAND_MAX_MS,
      failureRate: FAST_COMMAND_FAILURE_RATE,
    });
  }

  subscribeTelemetry(cb: (t: Telemetry) => void): Unsubscribe {
    this.#listeners.add(cb);
    return () => {
      this.#listeners.delete(cb);
    };
  }

  // --- SimulationControl -------------------------------------------------

  async resetFleet(): Promise<{ vehicles: number }> {
    this.#fleet.clear();
    await this.#loadFleet();
    await this.#reconcileActiveRides();
    return { vehicles: this.#fleet.size };
  }

  beginRide(vehicleId: string, rideId: string): void {
    const vehicle = this.#require(vehicleId);
    vehicle.ride = this.#buildRide(rideId, vehicle.position);
    vehicle.status = 'in_use';
  }

  finishRide(vehicleId: string): { distanceM: number; path: LatLon[] } | null {
    const vehicle = this.#fleet.get(vehicleId);
    if (vehicle?.ride == null) return null;

    const { distanceM, travelled } = vehicle.ride;
    vehicle.ride = null;
    vehicle.anchor = vehicle.position;
    vehicle.status = this.#statusForBattery({ ...vehicle, status: 'available' });
    return { distanceM, path: travelled };
  }

  async forceRide(vehicleId: string): Promise<{ rideId: string; routePoints: number }> {
    const vehicle = this.#require(vehicleId);
    if (vehicle.ride !== null) {
      return { rideId: vehicle.ride.rideId, routePoints: vehicle.ride.route.length };
    }

    const rider = await this.#pickAvailableRider();
    const rideId = await this.#repositories.rides.create({
      userId: rider,
      vehicleId,
      planId: await this.#perMinutePlanId(),
      startedAt: new Date(),
    });

    vehicle.ride = this.#buildRide(rideId, vehicle.position);
    vehicle.status = 'in_use';
    await this.#repositories.vehicles.updateStatus(vehicleId, 'in_use');

    return { rideId, routePoints: vehicle.ride.route.length };
  }

  async drainBattery(vehicleId: string, toPct: number): Promise<{ batteryPct: number }> {
    const vehicle = this.#require(vehicleId);
    vehicle.batteryPct = Math.max(0, Math.min(100, toPct));
    vehicle.status = this.#statusForBattery(vehicle);
    await this.#repositories.vehicles.updateTelemetryBatch([
      {
        id: vehicle.id,
        location: vehicle.position,
        batteryPct: Math.round(vehicle.batteryPct),
        status: vehicle.status,
      },
    ]);
    return { batteryPct: Math.round(vehicle.batteryPct) };
  }

  async setStatus(vehicleId: string, status: VehicleStatus): Promise<{ status: VehicleStatus }> {
    const vehicle = this.#require(vehicleId);
    vehicle.status = status;
    // Taking a vehicle offline abandons whatever it was doing.
    if (status !== 'in_use') vehicle.ride = null;
    await this.#repositories.vehicles.updateStatus(vehicleId, status);
    return { status };
  }

  snapshot(): SimulationSnapshot {
    let activeRides = 0;
    for (const vehicle of this.#fleet.values()) {
      if (vehicle.ride !== null) activeRides += 1;
    }
    return {
      running: this.#timer !== null,
      tickMs: env.SIMULATOR_TICK_MS,
      ticks: this.#ticks,
      vehicles: this.#fleet.size,
      activeRides,
      lastTickAt: this.#lastTickAt?.toISOString() ?? null,
    };
  }

  // --- internals ---------------------------------------------------------

  #require(vehicleId: string): SimulatedVehicle {
    const vehicle = this.#fleet.get(vehicleId);
    if (vehicle === undefined) {
      throw new Error(`Vehicle ${vehicleId} is not in the simulated fleet`);
    }
    return vehicle;
  }

  async #loadFleet(): Promise<void> {
    const vehicles = await this.#repositories.vehicles.listAll();
    for (const vehicle of vehicles) {
      this.#fleet.set(vehicle.id, {
        id: vehicle.id,
        qrCode: vehicle.qrCode,
        status: vehicle.status,
        batteryPct: vehicle.batteryPct,
        position: vehicle.location,
        anchor: vehicle.location,
        ride: null,
      });
    }
  }

  /**
   * The seed marks two vehicles `in_use` without ride rows, and a restart
   * loses in-memory routes. Give any in-use vehicle a ride so the fleet is
   * never in a state the rest of the system cannot explain.
   */
  async #reconcileActiveRides(): Promise<void> {
    for (const vehicle of this.#fleet.values()) {
      if (vehicle.status !== 'in_use' || vehicle.ride !== null) continue;

      const existing = await this.#repositories.rides.findActiveByVehicle(vehicle.id);
      const rideId =
        existing?.id ??
        (await this.#repositories.rides.create({
          userId: await this.#pickAvailableRider(),
          vehicleId: vehicle.id,
          planId: await this.#perMinutePlanId(),
          startedAt: new Date(),
        }));

      vehicle.ride = this.#buildRide(rideId, vehicle.position);
    }
  }

  #buildRide(rideId: string, from: LatLon): SimulatedRide {
    const destination = pickDestination(from, this.#rng);
    return {
      rideId,
      route: generateStreetRoute(from, destination, this.#rng),
      cursor: 1,
      speedMps: pickSpeedMps(this.#rng),
      travelled: [from],
      distanceM: 0,
      startedAt: new Date(),
    };
  }

  #statusForBattery(vehicle: SimulatedVehicle): VehicleStatus {
    // Never override a status a human or the fleet operator chose.
    if (vehicle.status === 'maintenance' || vehicle.status === 'in_use') return vehicle.status;
    if (vehicle.batteryPct <= 0) return 'offline';
    if (vehicle.batteryPct < LOW_BATTERY_THRESHOLD_PCT) return 'low_battery';
    if (vehicle.status === 'low_battery' || vehicle.status === 'offline') return 'available';
    return vehicle.status;
  }

  async #cachePricing(): Promise<void> {
    const plan = await this.#repositories.plans.findByKind('per_minute');
    this.#perMinutePlan = plan === null ? null : { unlockFee: plan.unlockFee, price: plan.price };
  }

  /**
   * Cost accrued so far, for the admin's live rides table. Uses the same
   * shared pricing function the receipt will, so the number a viewer watches
   * climb is the number they are eventually charged.
   */
  #liveCost(durationS: number): number {
    const plan = this.#perMinutePlan;
    if (plan === null) return 0;
    return calculateRideCost({
      plan: { kind: 'per_minute', unlockFee: plan.unlockFee, price: plan.price },
      durationS,
      distanceM: 0,
    }).total;
  }

  async #perMinutePlanId(): Promise<string> {
    const plan = await this.#repositories.plans.findByKind('per_minute');
    if (plan === null) throw new Error('No per_minute plan seeded — run pnpm db:seed');
    return plan.id;
  }

  /**
   * Simulated rides run under reserved accounts only. Using a real demo
   * account would leave whoever logs in for the demo holding a phantom ride,
   * because a rider may only have one ride in flight.
   */
  async #pickAvailableRider(): Promise<string> {
    const users = await this.#repositories.users.listAll();
    for (const user of users) {
      if (user.status !== 'active' || !isSimulatorRider(user.phone)) continue;
      const active = await this.#repositories.rides.findActiveByUser(user.id);
      if (active === null) return user.id;
    }
    throw new Error(
      'No simulator rider account free — all are mid-ride, or the seed is stale. Run pnpm db:seed.',
    );
  }

  /** Simulates a command round-trip and records it in the commands table. */
  async #dispatch(
    vehicleId: string,
    type: CommandType,
    options: { minMs: number; maxMs: number; failureRate: number },
  ): Promise<CommandResult> {
    const vehicle = this.#fleet.get(vehicleId);
    const commandId = await this.#repositories.commands.open(vehicleId, type);

    const latencyMs = Math.round(options.minMs + this.#rng() * (options.maxMs - options.minMs));
    await delay(latencyMs);

    // An offline vehicle cannot answer, whatever the failure rate says.
    const unreachable = vehicle === undefined || vehicle.status === 'offline';
    const failed = unreachable || this.#rng() < options.failureRate;

    if (failed) {
      const reason = unreachable
        ? 'Scooter is offline and did not respond'
        : (UNLOCK_FAILURE_REASONS[Math.floor(this.#rng() * UNLOCK_FAILURE_REASONS.length)] ??
          UNLOCK_FAILURE_REASONS[0]);

      await this.#repositories.commands.settle(commandId, {
        status: 'failed',
        failureReason: reason,
      });
      return {
        commandId,
        vehicleId,
        type,
        status: 'failed',
        ok: false,
        failureReason: reason,
        latencyMs,
      };
    }

    await this.#repositories.commands.settle(commandId, { status: 'acked', failureReason: null });
    return {
      commandId,
      vehicleId,
      type,
      status: 'acked',
      ok: true,
      failureReason: null,
      latencyMs,
    };
  }

  async #tick(): Promise<void> {
    const now = new Date();
    const tickSeconds = env.SIMULATOR_TICK_MS / 1000;

    const telemetry: Telemetry[] = [];
    const updates: {
      id: string;
      location: LatLon;
      batteryPct: number;
      status: VehicleStatus;
    }[] = [];
    const rideWrites: Promise<void>[] = [];
    const rideProgress: {
      rideId: string;
      distanceM: number;
      durationS: number;
      currentCost: number;
      location: LatLon;
    }[] = [];

    for (const vehicle of this.#fleet.values()) {
      // Offline and maintenance vehicles report nothing — that is what makes
      // them look genuinely offline on the map.
      if (vehicle.status === 'offline' || vehicle.status === 'maintenance') continue;

      let speedMps = 0;

      if (vehicle.ride !== null) {
        speedMps = this.#advanceRide(vehicle, tickSeconds);
        vehicle.batteryPct = Math.max(0, vehicle.batteryPct - RIDING_DRAIN_PCT_PER_TICK);

        const ride = vehicle.ride;
        if (ride !== null) {
          const durationS = (now.getTime() - ride.startedAt.getTime()) / 1000;
          rideWrites.push(
            this.#repositories.rides.updateProgress(ride.rideId, {
              path: ride.travelled,
              distanceM: ride.distanceM,
              durationS,
            }),
          );
          rideProgress.push({
            rideId: ride.rideId,
            distanceM: Math.round(ride.distanceM),
            durationS: Math.round(durationS),
            // Settled authoritatively at end-ride; this is the live ticker.
            currentCost: this.#liveCost(durationS),
            location: vehicle.position,
          });
        }
      } else {
        this.#driftIdle(vehicle);
        // Drain toward the floor, never through it, and never charge a vehicle
        // that is already below it.
        vehicle.batteryPct = Math.max(
          Math.min(vehicle.batteryPct, IDLE_DRAIN_FLOOR_PCT),
          vehicle.batteryPct - IDLE_DRAIN_PCT_PER_TICK,
        );
      }

      vehicle.status = this.#statusForBattery(vehicle);

      updates.push({
        id: vehicle.id,
        location: vehicle.position,
        batteryPct: Math.round(vehicle.batteryPct),
        status: vehicle.status,
      });

      telemetry.push({
        vehicleId: vehicle.id,
        batteryPct: Math.round(vehicle.batteryPct),
        lat: vehicle.position.lat,
        lon: vehicle.position.lon,
        speedMps,
        reportedAt: now.toISOString(),
      });
    }

    await this.#repositories.vehicles.updateTelemetryBatch(updates);
    await Promise.all(rideWrites);

    // Feed the admin panel's live map and rides table. Without this the panel
    // would have to poll, which the brief rules out.
    for (const update of updates) {
      publishEvent({
        type: 'vehicle.updated',
        vehicleId: update.id,
        status: update.status,
        batteryPct: update.batteryPct,
        location: update.location,
      });
    }
    for (const progress of rideProgress) {
      publishEvent({ type: 'ride.updated', ...progress });
    }

    for (const frame of telemetry) {
      for (const listener of this.#listeners) {
        try {
          listener(frame);
        } catch (error: unknown) {
          // One bad subscriber must never stall the fleet.
          logError('Telemetry listener threw', error);
        }
      }
    }

    this.#ticks += 1;
    this.#lastTickAt = now;
  }

  /** Random walk around the anchor — parked scooters jitter, they don't wander. */
  #driftIdle(vehicle: SimulatedVehicle): void {
    const angle = this.#rng() * 2 * Math.PI;
    const step = this.#rng() * IDLE_DRIFT_STEP_M;
    const candidate = offsetMetres(vehicle.position, step * Math.cos(angle), step * Math.sin(angle));

    vehicle.position =
      haversineDistanceM(vehicle.anchor, candidate) <= IDLE_DRIFT_RADIUS_M
        ? candidate
        : vehicle.anchor;
  }

  /** Advance along the route; returns the speed travelled this tick. */
  #advanceRide(vehicle: SimulatedVehicle, tickSeconds: number): number {
    const ride = vehicle.ride;
    if (ride === null) return 0;

    let remaining = ride.speedMps * tickSeconds;

    while (remaining > 0 && ride.cursor < ride.route.length) {
      const target = ride.route[ride.cursor];
      if (target === undefined) break;

      const gap = haversineDistanceM(vehicle.position, target);

      if (gap <= remaining) {
        vehicle.position = target;
        ride.distanceM += gap;
        ride.travelled.push(target);
        ride.cursor += 1;
        remaining -= gap;
      } else {
        const t = remaining / gap;
        vehicle.position = {
          lat: vehicle.position.lat + (target.lat - vehicle.position.lat) * t,
          lon: vehicle.position.lon + (target.lon - vehicle.position.lon) * t,
        };
        ride.distanceM += remaining;
        remaining = 0;
      }
    }

    // Route exhausted: give the rider a fresh leg so demo rides keep moving
    // rather than parking themselves mid-demo.
    if (ride.cursor >= ride.route.length) {
      const destination = pickDestination(vehicle.position, this.#rng);
      ride.route = generateStreetRoute(vehicle.position, destination, this.#rng);
      ride.cursor = 1;
      ride.speedMps = pickSpeedMps(this.#rng);
    }

    vehicle.anchor = vehicle.position;
    return ride.speedMps;
  }
}
