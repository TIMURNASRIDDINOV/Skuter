import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';

/**
 * Schema-level operations that do not belong to a single entity. Kept in the
 * repository layer so no raw SQL leaks into the seed script or the routes.
 */
export function createMaintenanceRepository(db: Database) {
  return {
    /**
     * Wipe all application data. Ordered by dependency and run as one
     * statement so foreign keys never block it. Used by `pnpm db:seed` and by
     * the fleet-reset dev endpoint.
     */
    async truncateAll(): Promise<void> {
      await db.execute(sql`
        TRUNCATE TABLE
          audit_log, payments, commands, rides, subscriptions,
          otp_codes, vehicles, zones, areas, plans, admins, users
        RESTART IDENTITY CASCADE
      `);
    },

    /** Sanity check used by the seed: every vehicle inside the service area. */
    async countVehiclesOutsideServiceArea(): Promise<number> {
      const result = await db.execute<{ outside: number }>(sql`
        SELECT count(*)::int AS outside
        FROM vehicles v
        WHERE NOT EXISTS (
          SELECT 1 FROM areas a WHERE ST_Contains(a.geom, v.geom)
        )
      `);
      return result.rows[0]?.outside ?? 0;
    },
  };
}

export type MaintenanceRepository = ReturnType<typeof createMaintenanceRepository>;
