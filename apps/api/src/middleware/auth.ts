import { createMiddleware } from 'hono/factory';
import type { AdminRole } from '@scoot/shared';
import { forbidden, unauthorized } from '../lib/errors.js';
import { readToken } from '../lib/jwt.js';
import { repositories } from '../repositories/index.js';

export type AuthContext =
  | { role: 'rider'; userId: string }
  | { role: 'admin'; adminId: string; adminRole: AdminRole };

export interface AppEnv {
  Variables: {
    auth: AuthContext;
  };
}

function bearerToken(header: string | undefined): string {
  if (header === undefined || !header.startsWith('Bearer ')) {
    throw unauthorized('Missing Bearer token');
  }
  const token = header.slice('Bearer '.length).trim();
  if (token === '') throw unauthorized('Missing Bearer token');
  return token;
}

/** Requires a rider token and a user record that is not blocked. */
export const requireRider = createMiddleware<AppEnv>(async (c, next) => {
  const claims = await readToken(bearerToken(c.req.header('Authorization')));
  if (claims.role !== 'rider') throw forbidden('This endpoint requires a rider token');

  const user = await repositories.users.findById(claims.sub);
  if (user === null) throw unauthorized('Account no longer exists');
  if (user.status === 'blocked') throw forbidden('This account is blocked');

  c.set('auth', { role: 'rider', userId: user.id });
  await next();
});

/** Requires an admin token backed by an existing admin record. */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const claims = await readToken(bearerToken(c.req.header('Authorization')));
  if (claims.role !== 'admin') throw forbidden('This endpoint requires an admin token');

  const admin = await repositories.admins.findById(claims.sub);
  if (admin === null) throw unauthorized('Admin account no longer exists');

  c.set('auth', { role: 'admin', adminId: admin.id, adminRole: admin.role });
  await next();
});

/**
 * Narrow an auth context to a concrete subject. The matching middleware has
 * already run, so these throwing accessors are a type-level formality rather
 * than a real branch — they keep handlers free of casts.
 */
export function riderIdOf(auth: AuthContext): string {
  if (auth.role !== 'rider') throw unauthorized('Rider token required');
  return auth.userId;
}

export function adminOf(auth: AuthContext): { adminId: string; adminRole: AdminRole } {
  if (auth.role !== 'admin') throw unauthorized('Admin token required');
  return { adminId: auth.adminId, adminRole: auth.adminRole };
}

/** Narrows an admin context by role; `owner` passes every check. */
export function requireAdminRole(...allowed: readonly AdminRole[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const auth = c.get('auth');
    if (auth.role !== 'admin') throw forbidden('This endpoint requires an admin token');
    if (auth.adminRole !== 'owner' && !allowed.includes(auth.adminRole)) {
      throw forbidden(`Requires one of: ${allowed.join(', ')}`);
    }
    await next();
  });
}
