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

/**
 * Office-only plans are filtered out on purpose: they are agreements made at a
 * desk, not something the app can sell, and a tariff the rider cannot buy has
 * no business in the picker. That one filter is what keeps a week-long rental
 * out of the vehicle sheet, the plan screen and Аренда without any client-side
 * special-casing — and it is why the app can offer 3h, 5h and 24h without
 * knowing anything about which of them is "long".
 */
catalogRoutes.get('/plans', requireRider, async (c) => {
  const items: Plan[] = (await repositories.plans.listActive()).filter((plan) => !plan.officeOnly);
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
