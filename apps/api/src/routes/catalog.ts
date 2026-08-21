import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { listZonesQuerySchema, type Area, type Plan, type Zone } from '@ozothunder/shared';
import { repositories } from '../repositories/index.js';
import { requireRider, type AppEnv } from '../middleware/auth.js';

/**
 * Reference data both clients need: pricing plans, zones and service areas.
 * The rider app pulls zones here on pull-to-refresh (demo step 7).
 */
export const catalogRoutes = new Hono<AppEnv>();

catalogRoutes.get('/plans', requireRider, async (c) => {
  const items: Plan[] = await repositories.plans.listActive();
  return c.json({ items, total: items.length });
});

catalogRoutes.get('/zones', requireRider, zValidator('query', listZonesQuerySchema), async (c) => {
  const items: Zone[] = await repositories.zones.list(c.req.valid('query'));
  return c.json({ items, total: items.length });
});

catalogRoutes.get('/areas', requireRider, async (c) => {
  const items: Area[] = await repositories.areas.list();
  return c.json({ items, total: items.length });
});
