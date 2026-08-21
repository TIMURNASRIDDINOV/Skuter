import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { adminLoginRequestSchema, type AdminSession } from '@ozothunder/shared';
import { unauthorized } from '../lib/errors.js';
import { issueToken } from '../lib/jwt.js';
import { verifySecret } from '../lib/password.js';
import { repositories } from '../repositories/index.js';
import { adminOf, requireAdmin, type AppEnv } from '../middleware/auth.js';

/** Back-office email + password authentication. */
export const adminAuthRoutes = new Hono<AppEnv>();

adminAuthRoutes.post('/login', zValidator('json', adminLoginRequestSchema), async (c) => {
  const { email, password } = c.req.valid('json');

  const record = await repositories.admins.findByEmailWithHash(email);
  // Same message and roughly the same work either way, so the response does
  // not reveal whether the address exists.
  if (record === null) {
    await verifySecret(password, '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin');
    throw unauthorized('Incorrect email or password');
  }

  const matches = await verifySecret(password, record.passwordHash);
  if (!matches) throw unauthorized('Incorrect email or password');

  const body: AdminSession = {
    token: await issueToken(record.admin.id, 'admin'),
    admin: record.admin,
  };
  return c.json(body);
});

adminAuthRoutes.get('/me', requireAdmin, async (c) => {
  const { adminId } = adminOf(c.get('auth'));
  const admin = await repositories.admins.findById(adminId);
  if (admin === null) throw unauthorized('Admin account no longer exists');
  return c.json(admin);
});
