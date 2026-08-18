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
import { publishEvent, serverEvents } from '../events/bus.js';
import { logError, logInfo, logWarn } from '../lib/logger.js';
import type { Repositories } from '../repositories/index.js';
import { mulberry32, offsetMetres, type Rng } from '../seed/random.js';
import { isSimulatorRider } from '../seed/riders.js';
import { settleRide } from '../services/settlement.js';
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

/**
 * How often a parked vehicle's position is written to Postgres when nothing
 * about it has changed.
 *
 * The live map is fed from memory over SSE, so the database write exists only
 * so a restart or a Durable Object eviction rehydrates the fleet roughly where
 * it left off. Once every idle vehicle has settled on the drain floor, writing
 * all of them every tick means rewriting identical batteries and a couple of
 * metres of GPS noise for the whole fleet, indefinitely. Anything that a rider
 * or the back office can actually observe — a status move, a whole-percent
 * battery step, a vehicle under way — still flushes on the tick it happens.
 */
const IDLE_FLUSH_EVERY_N_TICKS = 20;

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

/**
 * How many street legs a simulated ride runs before it settles.
 *
 * A leg is one `generateStreetRoute` — roughly 2 km, so a few minutes of
 * motion. Rides used to be endless: `#advanceRide` handed out a fresh leg
 * whenever one ran out, so a demo ride started at seed time was still running
 * days later. That kept `activeRides` permanently above zero, which pinned the
 * Durable Object alarm at its 3 s cadence and meant the fleet was never idle
 * enough for the back-off in `durable-object.ts` to engage.
 *
 * Randomised so the seeded rides do not all finish on the same tick.
 */
const SIMULATED_RIDE_MIN_LEGS = 1;
const SIMULATED_RIDE_MAX_LEGS = 3;

/**
 * Hard wall-clock ceiling on a simulated ride, measured from the `started_at`
 * on its row rather than from anything in memory.
 *
 * The leg budget alone is not enough. Fleet state is rehydrated on every
 * Durable Object start — a deploy, an eviction, a migration — and
 * `#reconcileActiveRides` adopts whatever is still in flight. Handing those a
 * fresh budget means a ride's lease renews every restart, so under regular
 * evictions a simulated ride never finishes and the fleet is never idle. That
 * is exactly the state this whole change set exists to reach, and it hid in
 * production behind a 3 s cadence that looked like rides legitimately running.
 *
 * The row's timestamp survives all of that, so this ceiling actually holds.
 */
const SIMULATED_RIDE_MAX_DURATION_MS = 20 * 60 * 1000;

/**
 * Spontaneous demo traffic, and the rule that makes it free.
 *
 * Once rides finish (see the leg budget above) the fleet parks and stays
 * parked — nothing starts a simulated ride on its own, so a client opening the
 * back office cold would see 70 stationary scooters. But keeping traffic
 * running around the clock is exactly the standing bill the tick work was
 * about removing.
 *
 * So the simulator only manufactures traffic **while somebody is watching**:
 * an admin on the SSE stream. With no subscriber the fleet stays quiet, the
 * alarm backs off to 30 s and a tick costs nothing. The moment the panel
 * connects, the map fills up again within a minute.
 */
const DEMO_TRAFFIC_TARGET_RIDES = 3;
/** Stagger starts, so three rides do not all begin on the same tick. */
const DEMO_TRAFFIC_START_EVERY_N_TICKS = 8;

const NO_FREE_RIDER =
  'No simulator rider account free — all are mid-ride, or the seed is stale. Run pnpm db:seed.';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SimulatedGateway implements ManagedVehicleGateway, SimulationControl {
  readonly #repositories: Repositories;
  readonly #rng: Rng = mulberry32(0x5c007);
  readonly #fleet = new Map<string, SimulatedVehicle>();
  readonly #listeners = new Set<(t: Telemetry) => void>();

  #timer: NodeJS.Timeout | null = null;
  #started = false;
  #ticks = 0;
  #lastTickAt: Date | null = null;
  #ticking = false;
  /** Tick index of the last spontaneous ride start, for the stagger above. */
  #lastTrafficStartTick = Number.NEGATIVE_INFINITY;
  /** Cached so the live cost ticker does not hit the database every tick. */
  #perMinutePlan: { id: string; unlockFee: number; price: number } | null = null;

  constructor(repositories: Repositories) {
    this.#repositories = repositories;
  }

  // --- lifecycle ---------------------------------------------------------

  /**
   * Load fleet state without starting the Node interval — the Durable Object
   * host drives ticks itself through `tickOnce()` on its alarm.
   */
  async prepare(): Promise<void> {
    await this.#loadFleet();
    await this.#cachePricing();
    await this.#reconcileActiveRides();
    this.#started = true;
  }

  async start(): Promise<void> {
    if (this.#timer !== null) return;

    await this.prepare();

    this.#timer = setInterval(() => {
      void this.tickOnce();
    }, env.SIMULATOR_TICK_MS);

    logInfo(
      `Simulator started — ${this.#fleet.size} vehicles, tick ${env.SIMULATOR_TICK_MS}ms, ` +
        `unlock failure rate ${(env.SIMULATOR_UNLOCK_FAILURE_RATE * 100).toFixed(0)}%`,
    );
  }

  /** One guarded tick — ticks are async and must never overlap. */
  async tickOnce(): Promise<void> {
    if (this.#ticking) return;
    this.#ticking = true;
    try {
      await this.#tick();
    } catch (error: unknown) {
      logError('Simulator tick failed', error);
    } finally {
      this.#ticking = false;
    }
  }

  async stop(): Promise<void> {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#started = false;
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

  // eslint-disable-next-line @typescript-eslint/require-await
  async beginRide(vehicleId: string, rideId: string): Promise<void> {
    const vehicle = this.#require(vehicleId);
    // A person is on this scooter. Never auto-finish it.
    vehicle.ride = this.#buildRide(rideId, vehicle.position, false, null, new Date());
    vehicle.status = 'in_use';
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async finishRide(vehicleId: string): Promise<{ distanceM: number; path: LatLon[] } | null> {
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

    vehicle.ride = this.#buildRide(rideId, vehicle.position, true, rider, new Date());
    vehicle.status = 'in_use';
    await this.#repositories.vehicles.updateStatus(vehicleId, 'in_use');

    return { rideId, routePoints: vehicle.ride.route.length };
  }

  async drainBattery(vehicleId: string, toPct: number): Promise<{ batteryPct: number }> {
    const vehicle = this.#require(vehicleId);
    vehicle.batteryPct = Math.max(0, Math.min(100, toPct));
    vehicle.status = this.#statusForBattery(vehicle);

    const batteryPct = Math.round(vehicle.batteryPct);
    await this.#repositories.vehicles.updateTelemetryBatch([
      {
        id: vehicle.id,
        location: vehicle.position,
        batteryPct,
        status: vehicle.status,
      },
    ]);
    // Written here, so the next tick has no change to flush.
    vehicle.flushedStatus = vehicle.status;
    vehicle.flushedBatteryPct = batteryPct;

    return { batteryPct };
  }

  async setStatus(vehicleId: string, status: VehicleStatus): Promise<{ status: VehicleStatus }> {
    const vehicle = this.#require(vehicleId);
    vehicle.status = status;
    // Taking a vehicle offline abandons whatever it was doing.
    if (status !== 'in_use') vehicle.ride = null;
    await this.#repositories.vehicles.updateStatus(vehicleId, status);
    vehicle.flushedStatus = status;
    return { status };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async snapshot(): Promise<SimulationSnapshot> {
    let activeRides = 0;
    for (const vehicle of this.#fleet.values()) {
      if (vehicle.ride !== null) activeRides += 1;
    }
    return {
      running: this.#started,
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
        // Just read from Postgres, so it is already in sync.
        flushedStatus: vehicle.status,
        flushedBatteryPct: vehicle.batteryPct,
      });
    }
  }

  /**
   * The seed marks two vehicles `in_use` without ride rows, and a restart
   * loses in-memory routes. Give any in-use vehicle a ride so the fleet is
   * never in a state the rest of the system cannot explain.
   */
  async #reconcileActiveRides(): Promise<void> {
    const stranded = [...this.#fleet.values()].filter(
      (vehicle) => vehicle.status === 'in_use' && vehicle.ride === null,
    );
    if (stranded.length === 0) return;

    // One read for the whole fleet, rather than a findActiveByVehicle each.
    const active = new Map(
      (await this.#repositories.rides.listActive()).map((ride) => [ride.vehicleId, ride]),
    );

    // Drawn once and consumed. Re-reading per vehicle would both cost a query
    // each and read back rides created moments earlier — which behind
    // Hyperdrive can be served from before the write, handing the same rider
    // to two vehicles and tripping the one-active-ride-per-rider index.
    const pool = stranded.length > active.size ? await this.#idleSimulatorRiders() : [];
    const planId = await this.#perMinutePlanId();

    for (const vehicle of stranded) {
      const existing = active.get(vehicle.id);
      let rideId = existing?.id;
      let userId = existing?.userId ?? null;
      // An adopted ride is only ours to end if a reserved simulator account
      // owns it. A real rider's ride surviving an eviction stays theirs.
      let autoFinish =
        existing !== undefined &&
        existing.userPhone !== null &&
        isSimulatorRider(existing.userPhone);

      if (rideId === undefined) {
        userId = pool.shift() ?? null;
        if (userId === null) throw new Error(NO_FREE_RIDER);
        rideId = await this.#repositories.rides.create({
          userId,
          vehicleId: vehicle.id,
          planId,
          startedAt: new Date(),
        });
        // Created here, so it is a simulator account by construction.
        autoFinish = true;
      }

      // The row's own start time, so an adopted ride keeps its real age —
      // both for the ceiling above and for the live duration the panel shows.
      vehicle.ride = this.#buildRide(
        rideId,
        vehicle.position,
        autoFinish,
        userId,
        existing === undefined ? new Date() : new Date(existing.startedAt),
      );
    }
  }

  #buildRide(
    rideId: string,
    from: LatLon,
    autoFinish: boolean,
    userId: string | null,
    startedAt: Date,
  ): SimulatedRide {
    const destination = pickDestination(from, this.#rng);
    const spread = SIMULATED_RIDE_MAX_LEGS - SIMULATED_RIDE_MIN_LEGS + 1;
    return {
      rideId,
      userId,
      autoFinish,
      legsRemaining: SIMULATED_RIDE_MIN_LEGS + Math.floor(this.#rng() * spread),
      spent: false,
      route: generateStreetRoute(from, destination, this.#rng),
      cursor: 1,
      speedMps: pickSpeedMps(this.#rng),
      travelled: [from],
      distanceM: 0,
      startedAt,
    };
  }

  #statusForBattery(vehicle: SimulatedVehicle): VehicleStatus {
    // Never override a status a human or the fleet operator chose. `reserved`
    // belongs here too: a held scooter idles and still drains, and letting the
    // battery flip it to `low_battery` would silently drop a rider's hold
    // while they were walking to it. Reservations expire on their own clock.
    if (
      vehicle.status === 'maintenance' ||
      vehicle.status === 'in_use' ||
      vehicle.status === 'reserved'
    ) {
      return vehicle.status;
    }
    if (vehicle.batteryPct <= 0) return 'offline';
    if (vehicle.batteryPct < LOW_BATTERY_THRESHOLD_PCT) return 'low_battery';
    if (vehicle.status === 'low_battery' || vehicle.status === 'offline') return 'available';
    return vehicle.status;
  }

  async #cachePricing(): Promise<void> {
    const plan = await this.#repositories.plans.findByKind('per_minute');
    this.#perMinutePlan =
      plan === null ? null : { id: plan.id, unlockFee: plan.unlockFee, price: plan.price };
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

  /**
   * The cached plan's id. `#cachePricing` already read this row at startup; it
   * used to be re-queried on every call, which made creating one simulated
   * ride cost an extra round-trip for a value that cannot change under us.
   */
  async #perMinutePlanId(): Promise<string> {
    if (this.#perMinutePlan === null) await this.#cachePricing();
    const plan = this.#perMinutePlan;
    if (plan === null) throw new Error('No per_minute plan seeded — run pnpm db:seed');
    return plan.id;
  }

  /**
   * Simulated rides run under reserved accounts only. Using a real demo
   * account would leave whoever logs in for the demo holding a phantom ride,
   * because a rider may only have one ride in flight.
   */
  async #pickAvailableRider(): Promise<string> {
    const [rider] = await this.#idleSimulatorRiders();
    if (rider === undefined) throw new Error(NO_FREE_RIDER);
    return rider;
  }

  /**
   * Reserved simulator accounts with no ride in flight, newest last.
   *
   * One statement — this used to be `users.listAll()` followed by a
   * `findActiveByUser` per user, which is the whole fleet's worth of round
   * trips to find one free account.
   */
  async #idleSimulatorRiders(): Promise<string[]> {
    // Anyone the simulator has already put on a scooter is excluded from
    // memory rather than trusted to have disappeared from this read: the read
    // follows the ride insert, and Hyperdrive can serve it from before.
    const riding = new Set<string>();
    for (const vehicle of this.#fleet.values()) {
      if (vehicle.ride?.userId != null) riding.add(vehicle.ride.userId);
    }

    const idle = await this.#repositories.users.listIdle();
    return idle
      .filter(
        (user) => user.phone !== null && isSimulatorRider(user.phone) && !riding.has(user.id),
      )
      .map((user) => user.id);
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
    // What the back office is told, every tick, for every vehicle that
    // reported. Kept separate from `updates` — the SSE fan-out is cheap and
    // must stay complete, while the database write below is filtered down to
    // rows that actually changed.
    const frames: {
      id: string;
      location: LatLon;
      batteryPct: number;
      status: VehicleStatus;
    }[] = [];
    const updates: typeof frames = [];
    const rideWrites: { id: string; path: LatLon[]; distanceM: number; durationS: number }[] = [];
    /** Simulated rides that ran out of legs this tick and need settling. */
    const finished: { rideId: string; distanceM: number; path: LatLon[] }[] = [];
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

        // Age it out even mid-leg. A ride that has already been adopted across
        // a restart or two is old however much route it has left.
        if (ride.autoFinish && now.getTime() - ride.startedAt.getTime() >= SIMULATED_RIDE_MAX_DURATION_MS) {
          ride.spent = true;
        }

        if (ride.spent) {
          // Stop the motion now, so the scooter is parked on this tick's map
          // whatever the settlement below does. Settling is a database
          // conversation and belongs after the batch writes.
          finished.push({
            rideId: ride.rideId,
            distanceM: ride.distanceM,
            path: ride.travelled,
          });
          vehicle.ride = null;
          vehicle.anchor = vehicle.position;
          vehicle.status = this.#statusForBattery({ ...vehicle, status: 'available' });
        } else {
          const durationS = (now.getTime() - ride.startedAt.getTime()) / 1000;
          rideWrites.push({
            id: ride.rideId,
            path: ride.travelled,
            distanceM: ride.distanceM,
            durationS,
          });
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

      const batteryPct = Math.round(vehicle.batteryPct);
      const frame = {
        id: vehicle.id,
        location: vehicle.position,
        batteryPct,
        status: vehicle.status,
      };
      frames.push(frame);

      // A vehicle under way moved; a status move or a whole-percent battery
      // step is something a rider or the back office reads back out of
      // Postgres. Anything else is jitter, and waits for the periodic flush.
      const changed =
        vehicle.ride !== null ||
        vehicle.status !== vehicle.flushedStatus ||
        batteryPct !== vehicle.flushedBatteryPct;

      if (changed || this.#ticks % IDLE_FLUSH_EVERY_N_TICKS === 0) {
        updates.push(frame);
        vehicle.flushedStatus = vehicle.status;
        vehicle.flushedBatteryPct = batteryPct;
      }

      telemetry.push({
        vehicleId: vehicle.id,
        batteryPct,
        lat: vehicle.position.lat,
        lon: vehicle.position.lon,
        speedMps,
        reportedAt: now.toISOString(),
      });
    }

    await this.#repositories.vehicles.updateTelemetryBatch(updates);
    await this.#repositories.rides.updateProgressBatch(rideWrites);
    await this.#settleFinished(finished);
    await this.#keepDemoTrafficAlive();

    // Feed the admin panel's live map and rides table. Without this the panel
    // would have to poll, which the brief rules out.
    for (const frame of frames) {
      publishEvent({
        type: 'vehicle.updated',
        vehicleId: frame.id,
        status: frame.status,
        batteryPct: frame.batteryPct,
        location: frame.location,
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

  /**
   * Start a simulated ride when the map would otherwise be still, but only
   * while an admin is connected to the event stream.
   *
   * This is what makes "rides finish" survivable as a demo: the fleet parks
   * itself when nobody is looking, costs nothing there, and fills back up
   * within a minute of the back office being opened. Deliberately at most one
   * start per call and no more often than every
   * `DEMO_TRAFFIC_START_EVERY_N_TICKS`, so traffic ramps up rather than
   * arriving as a burst of inserts on one tick.
   */
  async #keepDemoTrafficAlive(): Promise<void> {
    // No audience: the fleet stays parked and the alarm backs off.
    if (serverEvents.subscriberCount === 0) return;
    if (this.#ticks - this.#lastTrafficStartTick < DEMO_TRAFFIC_START_EVERY_N_TICKS) return;

    const candidates: SimulatedVehicle[] = [];
    let riding = 0;
    for (const vehicle of this.#fleet.values()) {
      if (vehicle.ride !== null) riding += 1;
      else if (vehicle.status === 'available') candidates.push(vehicle);
    }
    if (riding >= DEMO_TRAFFIC_TARGET_RIDES || candidates.length === 0) return;

    const vehicle = candidates[Math.floor(this.#rng() * candidates.length)];
    if (vehicle === undefined) return;

    // Whatever happens below, do not try again for another few ticks — a
    // spent rider pool must not mean two queries every single tick.
    this.#lastTrafficStartTick = this.#ticks;

    try {
      const userId = await this.#pickAvailableRider();
      const rideId = await this.#repositories.rides.create({
        userId,
        vehicleId: vehicle.id,
        planId: await this.#perMinutePlanId(),
        startedAt: new Date(),
      });

      vehicle.ride = this.#buildRide(rideId, vehicle.position, true, userId, new Date());
      vehicle.status = 'in_use';
      // The status flush rides along with this tick's batch — `in_use` differs
      // from what was last written, so no extra statement is needed.

      publishEvent({ type: 'ride.started', rideId, userId, vehicleId: vehicle.id });
    } catch (error: unknown) {
      // Usually every reserved account is already out on a scooter. Not worth
      // an error: the fleet simply carries the traffic it has.
      logWarn(`Could not start demo traffic: ${error instanceof Error ? error.message : error}`);
    }
  }

  /**
   * Close out simulated rides that ran out of legs.
   *
   * Runs through the same `settleRide` the rider-facing end-ride uses, so a
   * demo ride produces a real cost, a payment row and a `ride.ended` event —
   * the admin revenue chart is reading genuine completed rides, not a fixture.
   *
   * Rare (once per ride, not per tick), so the per-ride reads are affordable
   * here in a way they would never be inside the fleet loop.
   *
   * A settle that throws leaves an active ride row behind while the vehicle is
   * already parked and available. That is deliberate: the motion has stopped
   * either way, and a stranded row is exactly what the operator force-end path
   * exists to clear. Retrying on the next tick would hammer a failing query
   * every three seconds instead.
   */
  async #settleFinished(
    finished: readonly { rideId: string; distanceM: number; path: LatLon[] }[],
  ): Promise<void> {
    for (const item of finished) {
      try {
        const ride = await this.#repositories.rides.findById(item.rideId);
        if (ride === null || ride.status !== 'active') continue;

        const settled = await settleRide(this.#repositories, ride, {
          endZoneId: null,
          finished: { distanceM: item.distanceM, path: item.path },
        });

        // settleRide wrote `available`; keep the flush markers in step so the
        // next tick does not rewrite a row that already says this.
        const vehicle = this.#fleet.get(ride.vehicleId);
        if (vehicle !== undefined) vehicle.flushedStatus = 'available';

        logInfo(
          `Simulated ride ${ride.id.slice(0, 8)} finished — ` +
            `${settled.distanceM}m in ${settled.durationS}s, ${settled.breakdown.total} tiyin`,
        );
      } catch (error: unknown) {
        logError(`Failed to settle simulated ride ${item.rideId}`, error);
      }
    }
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

    // Route exhausted. A rider's own ride simply gets another leg — only they
    // decide when it is over. A simulated one spends a leg and, once out,
    // parks itself for #tick to settle.
    if (ride.cursor >= ride.route.length) {
      ride.legsRemaining -= 1;

      if (ride.autoFinish && ride.legsRemaining <= 0) {
        ride.spent = true;
        return 0;
      }

      const destination = pickDestination(vehicle.position, this.#rng);
      ride.route = generateStreetRoute(vehicle.position, destination, this.#rng);
      ride.cursor = 1;
      ride.speedMps = pickSpeedMps(this.#rng);
    }

    vehicle.anchor = vehicle.position;
    return ride.speedMps;
  }
}
