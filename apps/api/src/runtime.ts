import { AsyncLocalStorage } from 'node:async_hooks';
import type { Database } from './db/client.js';
import type { EventSink } from './events/bus.js';
import type { ManagedVehicleGateway } from './gateway/types.js';

/**
 * The platform seam. On Node nothing populates this storage and every module
 * falls back to its process-wide singleton (pg Pool, in-process event bus) —
 * the dev loop is unchanged. On Cloudflare Workers each request (and each
 * Durable Object alarm) runs inside `runtimeStorage.run(...)` with a
 * per-request Hyperdrive-backed database handle and the appropriate event
 * sink, because Workers may not share sockets across requests.
 *
 * Only `db/client.ts` and `events/bus.ts` read this; everything else keeps
 * importing their stable `db` / `serverEvents` exports.
 */
export interface RuntimeContext {
  db: Database;
  events: EventSink;
  /** Set on Workers: the DurableGateway proxying the FleetSimulator DO. */
  gateway?: ManagedVehicleGateway;
}

export const runtimeStorage = new AsyncLocalStorage<RuntimeContext>();
