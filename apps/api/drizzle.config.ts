import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit bundles this config to CJS, where import.meta.dirname is
// undefined — resolve from cwd, which drizzle-kit sets to the package root.
const rootEnvPath = resolve(process.cwd(), '../../.env');
if (existsSync(rootEnvPath)) {
  loadDotenv({ path: rootEnvPath, quiet: true });
}

const databaseUrl = process.env['DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl === '') {
  throw new Error('DATABASE_URL is required to run drizzle-kit — see .env.example');
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },
  // PostGIS creates these in the public schema; they are not ours to manage.
  extensionsFilters: ['postgis'],
  tablesFilter: ['!spatial_ref_sys'],
  verbose: true,
  strict: true,
});
