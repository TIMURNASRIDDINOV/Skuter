import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDatabase, db } from './client.js';

/**
 * Applies migrations, ensuring PostGIS exists first.
 *
 * The docker-compose image enables the extension during initdb, but asserting
 * it here means the same `pnpm db:migrate` also works against a fresh Supabase
 * project or any other plain Postgres with PostGIS available.
 */
async function main(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS postgis`);

  const [row] = (
    await db.execute<{ version: string }>(sql`SELECT PostGIS_Lib_Version() AS version`)
  ).rows;
  process.stdout.write(`PostGIS ${row?.version ?? 'unknown'} ready\n`);

  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, 'migrations') });
  process.stdout.write('Migrations applied\n');
}

main()
  .then(async () => {
    await closeDatabase();
  })
  .catch(async (error: unknown) => {
    process.stderr.write(`Migration failed: ${String(error)}\n`);
    await closeDatabase();
    process.exitCode = 1;
  });
