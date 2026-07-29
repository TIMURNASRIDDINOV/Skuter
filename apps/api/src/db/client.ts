import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import { runtimeStorage } from '../runtime.js';
import * as schema from './schema.js';

/**
 * The database handle. Everything reaches Postgres through Drizzle and the
 * repository layer, so pointing DATABASE_URL at Supabase is the entire
 * migration — no code changes.
 *
 * On Node this lazily creates the one Pool for the process. On Cloudflare
 * Workers the runtime context carries a per-request Hyperdrive-backed handle
 * instead (Workers may not share sockets across requests), and the `db`
 * proxy below resolves it on every property access — so the repositories,
 * built once against `db`, work on both platforms unchanged.
 */

const { Pool, types } = pg;

// node-postgres hands back bigint (OID 20) as a string to avoid precision
// loss. Every bigint column here holds tiyin, comfortably inside Number.
// MAX_SAFE_INTEGER, so parse to number and keep the money types honest.
types.setTypeParser(types.builtins.INT8, (value: string) => Number.parseInt(value, 10));

export type Database = NodePgDatabase<typeof schema>;

/** Build a Drizzle handle from any pg client — the Workers entry uses this. */
export function createDatabase(client: pg.Pool | pg.Client): Database {
  return drizzle(client, { schema });
}

let nodePool: pg.Pool | null = null;
let nodeDb: Database | null = null;

function nodeDatabase(): Database {
  if (nodeDb === null) {
    nodePool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    nodeDb = createDatabase(nodePool);
  }
  return nodeDb;
}

function activeDatabase(): Database {
  return runtimeStorage.getStore()?.db ?? nodeDatabase();
}

/** Stable handle — resolves the platform's database on every access. */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop, _receiver) {
    const active = activeDatabase();
    const value = Reflect.get(active as object, prop) as unknown;
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(active) : value;
  },
});

export async function closeDatabase(): Promise<void> {
  if (nodePool !== null) {
    await nodePool.end();
    nodePool = null;
    nodeDb = null;
  }
}
