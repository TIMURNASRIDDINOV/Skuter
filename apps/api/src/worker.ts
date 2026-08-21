/// <reference types="@cloudflare/workers-types" />
import pg from 'pg';
import type { ServerEvent } from '@ozothunder/shared';
import { app } from './app.js';
import { createDatabase } from './db/client.js';
import type { EventSink } from './events/bus.js';
import { DurableGateway, type FleetStub } from './gateway/durable.js';
import { runtimeStorage } from './runtime.js';

export { FleetSimulator } from './gateway/durable-object.js';

/**
 * Cloudflare Workers entry. The Hono app is untouched — each request runs
 * inside a runtime context carrying:
 *
 *  - a fresh Hyperdrive-backed Drizzle handle (Workers may not share sockets
 *    across requests; Hyperdrive's warm pool makes connect() milliseconds),
 *  - an event sink that forwards publishes to the FleetSimulator DO,
 *  - a DurableGateway so ride/dev routes reach the simulator over RPC.
 *
 * Vars and secrets arrive through process.env (nodejs_compat), so env.ts
 * works unchanged.
 */

interface WorkerBindings {
  FLEET: DurableObjectNamespace;
  HYPERDRIVE: Hyperdrive;
}

function forwardingSink(stub: FleetStub, ctx: ExecutionContext): EventSink {
  return {
    publish: (event: ServerEvent) => {
      // RPC is async; keep it alive past the response without blocking it.
      ctx.waitUntil(stub.publish(event));
    },
    subscribe: () => {
      throw new Error('SSE subscriptions live in the FleetSimulator DO, not the Worker');
    },
    subscriberCount: 0,
  };
}

export default {
  async fetch(request: Request, bindings: WorkerBindings, ctx: ExecutionContext) {
    const stub = bindings.FLEET.get(bindings.FLEET.idFromName('fleet')) as unknown as FleetStub & {
      fetch: (request: Request) => Promise<Response>;
    };

    const client = new pg.Client({ connectionString: bindings.HYPERDRIVE.connectionString });
    await client.connect();

    try {
      return await runtimeStorage.run(
        {
          db: createDatabase(client),
          events: forwardingSink(stub, ctx),
          gateway: new DurableGateway(stub),
        },
        () => app.fetch(request as never, { fleetStub: stub }, ctx as never),
      );
    } finally {
      ctx.waitUntil(client.end());
    }
  },
};
