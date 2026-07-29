import type { ServerEvent } from '@scoot/shared';
import { logError } from '../lib/logger.js';
import { runtimeStorage } from '../runtime.js';

/**
 * In-process pub/sub feeding the admin panel's SSE stream.
 *
 * Single-process by design. On Node the module singleton below is the one
 * bus for the process. On Cloudflare Workers the runtime context supplies
 * the sink instead: inside the FleetSimulator Durable Object it is the DO's
 * own bus (which the SSE connections drain), while ordinary Worker requests
 * get a sink that forwards publishes to the DO over RPC.
 */

/** What a runtime context must provide as its event hub. */
export interface EventSink {
  publish(event: ServerEvent): void;
  subscribe(listener: (event: ServerEvent) => void): () => void;
  readonly subscriberCount: number;
}

/** A Set of listeners with error isolation — works on Node and Workers. */
export class ServerEventBus implements EventSink {
  readonly #listeners = new Set<(event: ServerEvent) => void>();

  publish(event: ServerEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error: unknown) {
        // A stalled SSE connection must never take the publisher down.
        logError('Server event listener threw', error);
      }
    }
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  get subscriberCount(): number {
    return this.#listeners.size;
  }
}

const nodeBus = new ServerEventBus();

function activeBus(): EventSink {
  return runtimeStorage.getStore()?.events ?? nodeBus;
}

/** Stable facade — resolves the platform's bus on every call. */
export const serverEvents: EventSink = {
  publish: (event) => activeBus().publish(event),
  subscribe: (listener) => activeBus().subscribe(listener),
  get subscriberCount() {
    return activeBus().subscriberCount;
  },
};

/**
 * Distributes over the event union — a plain `Omit<ServerEvent, 'at'>` would
 * collapse it to the shared keys and reject every variant's own fields.
 */
type WithoutTimestamp<T> = T extends unknown ? Omit<T, 'at'> : never;

/** Convenience: stamps `at` so publishers cannot forget it. */
export function publishEvent(event: WithoutTimestamp<ServerEvent>): void {
  serverEvents.publish({ ...event, at: new Date().toISOString() } as ServerEvent);
}
