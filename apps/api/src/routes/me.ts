import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { updateUserProfileRequestSchema, type UserProfile } from '@scoot/shared';
import { notFound } from '../lib/errors.js';
import { repositories } from '../repositories/index.js';
import { requireRider, riderIdOf, type AppEnv } from '../middleware/auth.js';

/** The signed-in rider's own profile. */
export const meRoutes = new Hono<AppEnv>();

meRoutes.get('/', requireRider, async (c) => {
  const user = await repositories.users.findById(riderIdOf(c.get('auth')));
  if (user === null) throw notFound('Account no longer exists');
  return c.json(user satisfies UserProfile);
});

meRoutes.patch('/', requireRider, zValidator('json', updateUserProfileRequestSchema), async (c) => {
  const { name } = c.req.valid('json');
  const user = await repositories.users.updateName(riderIdOf(c.get('auth')), name);
  if (user === null) throw notFound('Account no longer exists');
  return c.json(user satisfies UserProfile);
});
