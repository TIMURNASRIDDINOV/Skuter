import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  createSubscriptionRequestSchema,
  type CommandResult,
  type Rental,
  type SubscriptionDetail,
} from '@ozothunder/shared';
import { repositories } from '../repositories/index.js';
import { requireRider, riderIdOf, type AppEnv } from '../middleware/auth.js';
import {
  beepRental,
  expireLapsedSubscriptions,
  getActiveRental,
  listMySubscriptions,
  purchaseSubscription,
  setRentalLock,
} from '../services/subscriptions.js';

export const subscriptionRoutes = new Hono<AppEnv>();

/** Buy a daily pass bound to a specific scooter. Weekly is refused here. */
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

/**
 * The rider's live rental, and the thing the app polls to decide whether it
 * has a second face at all. Null means the ordinary app, wordmark and all.
 *
 * Sweeps lapsed rentals first, so a window that closed while nobody was
 * looking cannot outlive its expiry by more than one poll.
 */
subscriptionRoutes.get('/active', requireRider, async (c) => {
  await expireLapsedSubscriptions(repositories);
  const rental: Rental | null = await getActiveRental(repositories, riderIdOf(c.get('auth')));
  return c.json({ rental });
});

/** Switch the rented scooter on. No ride, no cost, no parking check. */
subscriptionRoutes.post('/:id/unlock', requireRider, async (c) => {
  const result = await setRentalLock(repositories, {
    userId: riderIdOf(c.get('auth')),
    subscriptionId: c.req.param('id'),
    unlocked: true,
  });
  return c.json(result);
});

subscriptionRoutes.post('/:id/lock', requireRider, async (c) => {
  const result = await setRentalLock(repositories, {
    userId: riderIdOf(c.get('auth')),
    subscriptionId: c.req.param('id'),
    unlocked: false,
  });
  return c.json(result);
});

subscriptionRoutes.post('/:id/beep', requireRider, async (c) => {
  const command: CommandResult = await beepRental(repositories, {
    userId: riderIdOf(c.get('auth')),
    subscriptionId: c.req.param('id'),
  });
  return c.json(command);
});

subscriptionRoutes.get('/', requireRider, async (c) => {
  const items: SubscriptionDetail[] = await listMySubscriptions(
    repositories,
    riderIdOf(c.get('auth')),
  );
  return c.json({ items, total: items.length });
});
