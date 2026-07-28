import { EventEmitter } from 'node:events';
import type { ServerEvent } from '@scoot/shared';
import { logError } from '../lib/logger.js';

/**
 * In-process pub/sub feeding the admin panel's SSE stream.
 *
 * Single-process by design. A multi-instance deployment would swap this for
 * Postgres LISTEN/NOTIFY or Redis; the publish/subscribe surface stays the
 * same, so nothing calling it would change.
 */
const CHANNEL = 'server-event';

class ServerEventBus {
  readonly #emitter = new EventEmitter();

  constructor() {
    // One listener per connected admin browser, plus headroom. The default of
    // 10 would print spurious leak warnings.
    this.#emitter.setMaxListeners(200);
  }

  publish(event: ServerEvent): void {
    this.#emitter.emit(CHANNEL, event);
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    const wrapped = (event: ServerEvent): void => {
      try {
        listener(event);
      } catch (error: unknown) {
        // A stalled SSE connection must never take the publisher down.
        logError('Server event listener threw', error);
      }
    };

    this.#emitter.on(CHANNEL, wrapped);
    return () => {
      this.#emitter.off(CHANNEL, wrapped);
    };
  }

  get subscriberCount(): number {
    return this.#emitter.listenerCount(CHANNEL);
  }
}

export const serverEvents = new ServerEventBus();

/**
 * Distributes over the event union — a plain `Omit<ServerEvent, 'at'>` would
 * collapse it to the shared keys and reject every variant's own fields.
 */
type WithoutTimestamp<T> = T extends unknown ? Omit<T, 'at'> : never;

/** Convenience: stamps `at` so publishers cannot forget it. */
export function publishEvent(event: WithoutTimestamp<ServerEvent>): void {
  serverEvents.publish({ ...event, at: new Date().toISOString() } as ServerEvent);
}
