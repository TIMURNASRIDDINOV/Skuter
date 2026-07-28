import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

/**
 * The one Postgres pool for the process. Everything reaches the database
 * through Drizzle and the repository layer, so pointing DATABASE_URL at
 * Supabase is the entire migration — no code changes.
 */

const { Pool, types } = pg;

// node-postgres hands back bigint (OID 20) as a string to avoid precision
// loss. Every bigint column here holds tiyin, comfortably inside Number.
// MAX_SAFE_INTEGER, so parse to number and keep the money types honest.
types.setTypeParser(types.builtins.INT8, (value: string) => Number.parseInt(value, 10));

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

export type Database = NodePgDatabase<typeof schema>;

export const db: Database = drizzle(pool, { schema });

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
