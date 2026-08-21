import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { createSubscriptionRequestSchema, type SubscriptionDetail } from '@ozothunder/shared';
import { repositories } from '../repositories/index.js';
import { requireRider, riderIdOf, type AppEnv } from '../middleware/auth.js';
import { listMySubscriptions, purchaseSubscription } from '../services/subscriptions.js';

export const subscriptionRoutes = new Hono<AppEnv>();

/** Demo step 6 — buy a weekly plan bound to a specific scooter. */
subscriptionRoutes.post(
  '/',
  requireRider,
  zValidator('json', createSubscriptionRequestSchema),
  async (c) => {
    const { planId, vehicleId } = c.req.valid('json');
    const result = await purchaseSubscription(repositories, {
      userId: riderIdOf(c.get('auth')),
      planId,
      vehicleId,
    });
    return c.json(result, 201);
  },
);

subscriptionRoutes.get('/', requireRider, async (c) => {
  const items: SubscriptionDetail[] = await listMySubscriptions(
    repositories,
    riderIdOf(c.get('auth')),
  );
  return c.json({ items, total: items.length });
});
