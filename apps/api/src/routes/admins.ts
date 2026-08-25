import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  API_ERROR_CODES,
  createAdminRequestSchema,
  updateAdminRequestSchema,
  type Admin,
} from '@ozothunder/shared';
import { conflict, notFound } from '../lib/errors.js';
import { hashSecret } from '../lib/password.js';
import { repositories } from '../repositories/index.js';
import { adminOf, requireAdmin, requireOwner, type AppEnv } from '../middleware/auth.js';

/**
 * Managing the other administrators.
 *
 * The owner's screen alone — `requireOwner`, not a permission, because a
 * permission that granted access here would let a staff account widen its own.
 * There is exactly one owner: the account the system was seeded with. Everyone
 * else is `staff`, and what they can reach is whatever the owner ticked.
 *
 * Passwords are set by the owner and handed over in person. There is no reset
 * email and no self-service, which is the right shape for a back office run by
 * a handful of people who know each other.
 */
export const adminAccountRoutes = new Hono<AppEnv>();

adminAccountRoutes.use('*', requireAdmin, requireOwner);

adminAccountRoutes.get('/', async (c) => {
  const items: Admin[] = await repositories.admins.list();
  return c.json({ items, total: items.length });
});

adminAccountRoutes.post('/', zValidator('json', createAdminRequestSchema), async (c) => {
  const body = c.req.valid('json');
  const { adminId } = adminOf(c.get('auth'));

  const existing = await repositories.admins.findByEmail(body.email);
  if (existing !== null) {
    throw conflict(API_ERROR_CODES.CONFLICT, 'An administrator with that address already exists');
  }

  const admin = await repositories.admins.insert({
    email: body.email,
    passwordHash: await hashSecret(body.password),
    role: 'staff',
    permissions: body.permissions,
  });

  await repositories.audit.append({
    adminId,
    action: 'admin.create',
    entity: 'admin',
    entityId: admin.id,
    // The permissions, never the password — the audit log is read by people.
    payload: { email: admin.email, permissions: admin.permissions },
  });

  return c.json(admin satisfies Admin, 201);
});

adminAccountRoutes.patch('/:id', zValidator('json', updateAdminRequestSchema), async (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const { adminId } = adminOf(c.get('auth'));

  const target = await requireStaffTarget(id, adminId);

  const admin = await repositories.admins.update(id, {
    ...(body.permissions === undefined ? {} : { permissions: body.permissions }),
    ...(body.password === undefined ? {} : { passwordHash: await hashSecret(body.password) }),
  });
  if (admin === null) throw notFound('No such administrator');

  await repositories.audit.append({
    adminId,
    action: 'admin.update',
    entity: 'admin',
    entityId: admin.id,
    payload: {
      email: target.email,
      permissions: admin.permissions,
      passwordChanged: body.password !== undefined,
    },
  });

  return c.json(admin satisfies Admin);
});

adminAccountRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const { adminId } = adminOf(c.get('auth'));

  const target = await requireStaffTarget(id, adminId);

  const removed = await repositories.admins.remove(id);
  if (!removed) throw notFound('No such administrator');

  await repositories.audit.append({
    adminId,
    action: 'admin.delete',
    entity: 'admin',
    entityId: id,
    payload: { email: target.email },
  });

  return c.json({ id });
});

/**
 * The two accounts an owner must not be able to edit or delete: itself, and
 * any other owner.
 *
 * Locking yourself out of your own back office is a support call nobody can
 * answer — there is no password reset here — so the guard is on the operation,
 * not on a confirmation dialog that can be clicked through.
 */
async function requireStaffTarget(id: string, selfId: string): Promise<Admin> {
  if (id === selfId) {
    throw conflict(API_ERROR_CODES.CONFLICT, 'You cannot change your own account here');
  }

  const target = await repositories.admins.findById(id);
  if (target === null) throw notFound('No such administrator');
  if (target.role === 'owner') {
    throw conflict(API_ERROR_CODES.CONFLICT, 'The owner account cannot be changed from here');
  }

  return target;
}
