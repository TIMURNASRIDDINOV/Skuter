/// <reference types="@cloudflare/workers-types" />
import { DurableObject } from 'cloudflare:workers';
import pg from 'pg';
import type { CommandResult, LatLon, ServerEvent, VehicleStatus } from '@scoot/shared';
import { createDatabase } from '../db/client.js';
import { env } from '../env.js';
import { ServerEventBus } from '../events/bus.js';
import { logError } from '../lib/logger.js';
import { createRepositories } from '../repositories/index.js';
import { runtimeStorage } from '../runtime.js';
import { SimulatedGateway } from './simulated.js';
import type { SimulationSnapshot } from './types.js';

interface FleetBindings {
  HYPERDRIVE: Hyperdrive;
}

/**
 * The Cloudflare home of the fleet simulator. One instance exists
 * (idFromName('fleet')); it hosts a real `SimulatedGateway` and:
 *
 *  - drives ticks with a self-rescheduling alarm every SIMULATOR_TICK_MS,
 *  - owns the event bus — Worker requests forward publishes here over RPC,
 *  - serves the admin SSE stream directly from `fetch()`, so live updates
 *    never cross an extra hop.
 *
 * Fleet state lives in memory exactly as on Node; a cold start rehydrates
 * from Postgres (`prepare()` → loadFleet + reconcileActiveRides), so deploys
 * and evictions cost one reload, not correctness.
 */
export class FleetSimulator extends DurableObject<FleetBindings> {
  readonly #gateway: SimulatedGateway;
  readonly #bus = new ServerEventBus();

  constructor(ctx: DurableObjectState, bindings: FleetBindings) {
    super(ctx, bindings);
    this.#gateway = new SimulatedGateway(createRepositories());
    ctx.blockConcurrencyWhile(async () => {
      await this.#withRuntime(() => this.#gateway.prepare());
      // First touch arms the clock; alarm() reschedules itself from then on.
      if ((await ctx.storage.getAlarm()) === null) {
        await ctx.storage.setAlarm(Date.now() + env.SIMULATOR_TICK_MS);
      }
    });
  }

  /**
   * Every piece of gateway work runs with a fresh Hyperdrive-backed client in
   * the runtime context — Workers may not share sockets across invocations,
   * and Hyperdrive keeps the warm pool so connect() costs milliseconds.
   */
  async #withRuntime<T>(fn: () => Promise<T>): Promise<T> {
    const client = new pg.Client({ connectionString: this.env.HYPERDRIVE.connectionString });
    await client.connect();
    try {
      return await runtimeStorage.run(
        { db: createDatabase(client), events: this.#bus },
        fn,
      );
    } finally {
      this.ctx.waitUntil(client.end());
    }
  }

  override async alarm(): Promise<void> {
    // Reschedule first so a slow tick delays the next one, not the clock.
    await this.ctx.storage.setAlarm(Date.now() + env.SIMULATOR_TICK_MS);
    try {
      await this.#withRuntime(() => this.#gateway.tickOnce());
    } catch (error: unknown) {
      // tickOnce already swallows tick errors; this catches connect failures.
      logError('FleetSimulator alarm failed', error);
    }
  }

  // --- RPC surface (mirrors FleetStub in gateway/durable.ts) ---------------

  unlock(vehicleId: string): Promise<CommandResult> {
    return this.#withRuntime(() => this.#gateway.unlock(vehicleId));
  }
  lock(vehicleId: string): Promise<CommandResult> {
    return this.#withRuntime(() => this.#gateway.lock(vehicleId));
  }
  beep(vehicleId: string): Promise<CommandResult> {
    return this.#withRuntime(() => this.#gateway.beep(vehicleId));
  }
  resetFleet(): Promise<{ vehicles: number }> {
    return this.#withRuntime(() => this.#gateway.resetFleet());
  }
  beginRide(vehicleId: string, rideId: string): Promise<void> {
    return this.#withRuntime(() => this.#gateway.beginRide(vehicleId, rideId));
  }
  finishRide(vehicleId: string): Promise<{ distanceM: number; path: LatLon[] } | null> {
    return this.#withRuntime(() => this.#gateway.finishRide(vehicleId));
  }
  forceRide(vehicleId: string): Promise<{ rideId: string; routePoints: number }> {
    return this.#withRuntime(() => this.#gateway.forceRide(vehicleId));
  }
  drainBattery(vehicleId: string, toPct: number): Promise<{ batteryPct: number }> {
    return this.#withRuntime(() => this.#gateway.drainBattery(vehicleId, toPct));
  }
  setStatus(vehicleId: string, status: VehicleStatus): Promise<{ status: VehicleStatus }> {
    return this.#withRuntime(() => this.#gateway.setStatus(vehicleId, status));
  }
  snapshot(): Promise<SimulationSnapshot> {
    return this.#withRuntime(() => this.#gateway.snapshot());
  }

  /** Worker requests forward their event publishes here. */
  publish(event: ServerEvent): void {
    this.#bus.publish(event);
  }

  // --- admin SSE ------------------------------------------------------------

  /**
   * The admin event stream. Token validation happened in the Worker route;
   * this only speaks SSE. Same wire format and 1 s drain cadence as the Node
   * implementation in routes/admin.ts, so apps/admin needs no changes.
   */
  override fetch(_request: Request): Response {
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const cleanup = (): void => {
      unsubscribe?.();
      unsubscribe = null;
      if (timer !== null) clearInterval(timer);
      timer = null;
    };

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const queue: string[] = [];
        const write = (event: string, data: string): void => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        };

        write('ready', JSON.stringify({ ok: true }));
        unsubscribe = this.#bus.subscribe((event) => {
          queue.push(JSON.stringify(event));
        });

        // Drain on an interval rather than per event, so a burst (70 vehicles
        // per tick) becomes a few writes instead of 70.
        timer = setInterval(() => {
          try {
            if (queue.length > 0) {
              for (const data of queue.splice(0, queue.length)) write('message', data);
            } else {
              // Keeps proxies from closing an idle connection.
              write(
                'message',
                JSON.stringify({ type: 'heartbeat', at: new Date().toISOString() }),
              );
            }
          } catch {
            // Controller rejected the write — the admin tab is gone.
            cleanup();
          }
        }, 1000);
      },
      cancel: () => {
        cleanup();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  }
}
