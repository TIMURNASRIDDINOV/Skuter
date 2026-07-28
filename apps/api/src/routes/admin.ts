import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { streamSSE } from 'hono/streaming';
import {
  createPlanRequestSchema,
  createZoneRequestSchema,
  listAuditLogQuerySchema,
  listRidesQuerySchema,
  listZonesQuerySchema,
  updatePlanRequestSchema,
  updateZoneRequestSchema,
  type DashboardStats,
  type RevenuePoint,
} from '@scoot/shared';
import { publishEvent, serverEvents } from '../events/bus.js';
import { notFound } from '../lib/errors.js';
import { repositories } from '../repositories/index.js';
import { adminOf, requireAdmin, requireAdminRole, type AppEnv } from '../middleware/auth.js';

export const adminRoutes = new Hono<AppEnv>();

// --- live event stream ---------------------------------------------------

/**
 * SSE feed powering the admin panel's live updates (demo step 3). The panel
 * subscribes once and updates its tables and map from these — it never polls.
 *
 * Authenticated by query token rather than a header, because EventSource
 * cannot set headers.
 */
adminRoutes.get('/events', async (c) => {
  const token = c.req.query('token');
  if (token === undefined || token === '') {
    return c.json({ error: { code: 'unauthorized', message: 'Missing token' } }, 401);
  }

  const { readToken } = await import('../lib/jwt.js');
  const claims = await readToken(token);
  if (claims.role !== 'admin') {
    return c.json({ error: { code: 'forbidden', message: 'Admin token required' } }, 403);
  }

  return streamSSE(c, async (stream) => {
    let open = true;
    const queue: string[] = [];

    const unsubscribe = serverEvents.subscribe((event) => {
      queue.push(JSON.stringify(event));
    });

    stream.onAbort(() => {
      open = false;
      unsubscribe();
    });

    await stream.writeSSE({ event: 'ready', data: JSON.stringify({ ok: true }) });

    // Drain on a short interval rather than writing from the emitter directly,
    // so a burst (70 vehicles per tick) becomes a few writes instead of 70.
    while (open) {
      if (queue.length > 0) {
        const batch = queue.splice(0, queue.length);
        for (const data of batch) {
          await stream.writeSSE({ event: 'message', data });
        }
      } else {
        // Keeps proxies from closing an idle connection.
        await stream.writeSSE({
          event: 'message',
          data: JSON.stringify({ type: 'heartbeat', at: new Date().toISOString() }),
        });
      }
      await stream.sleep(1000);
    }

    unsubscribe();
  });
});

// Everything below requires an admin token in the usual header.
adminRoutes.use('*', requireAdmin);

// --- dashboard -----------------------------------------------------------

adminRoutes.get('/stats', async (c) => {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [byStatus, total, activeRides, today, week, subscriptionsActive, usersTotal, avgBattery] =
    await Promise.all([
      repositories.vehicles.countByStatus(),
      repositories.vehicles.count(),
      repositories.rides.countActive(),
      repositories.rides.countCompletedSince(dayAgo),
      repositories.rides.countCompletedSince(weekAgo),
      repositories.subscriptions.countActive(),
      repositories.users.count(),
      repositories.vehicles.averageBattery(),
    ]);

  const stats: DashboardStats = {
    vehiclesTotal: total,
    vehiclesAvailable: byStatus.available,
    vehiclesInUse: byStatus.in_use,
    vehiclesOffline: byStatus.offline,
    vehiclesLowBattery: byStatus.low_battery,
    vehiclesMaintenance: byStatus.maintenance,
    ridesActive: activeRides,
    ridesToday: today.rides,
    subscriptionsActive,
    usersTotal,
    revenueTodayTiyin: today.revenueTiyin,
    revenueWeekTiyin: week.revenueTiyin,
    averageBatteryPct: avgBattery,
  };
  return c.json(stats);
});

adminRoutes.get('/revenue', async (c) => {
  const days = Number.parseInt(c.req.query('days') ?? '14', 10);
  const items: RevenuePoint[] = await repositories.rides.revenueByDay(
    Number.isFinite(days) ? Math.min(90, Math.max(1, days)) : 14,
  );
  return c.json({ items, total: items.length });
});

// --- tables --------------------------------------------------------------

adminRoutes.get('/rides', zValidator('query', listRidesQuerySchema), async (c) => {
  const items = await repositories.rides.listAll(c.req.valid('query'));
  return c.json({ items, total: items.length });
});

adminRoutes.get('/users', async (c) => {
  const items = await repositories.users.listAll();
  return c.json({ items, total: items.length });
});

adminRoutes.get('/subscriptions', async (c) => {
  const items = await repositories.subscriptions.listAll();
  return c.json({ items, total: items.length });
});

adminRoutes.get('/payments', async (c) => {
  const items = await repositories.payments.listAll();
  return c.json({ items, total: items.length });
});

adminRoutes.get('/commands', async (c) => {
  const items = await repositories.commands.listRecent(100);
  return c.json({ items, total: items.length });
});

adminRoutes.get('/audit', zValidator('query', listAuditLogQuerySchema), async (c) => {
  const items = await repositories.audit.list(c.req.valid('query'));
  return c.json({ items, total: items.length });
});

// --- zones (demo step 7) -------------------------------------------------

adminRoutes.get('/zones', zValidator('query', listZonesQuerySchema), async (c) => {
  const items = await repositories.zones.list(c.req.valid('query'));
  return c.json({ items, total: items.length });
});

adminRoutes.post(
  '/zones',
  requireAdminRole('operator'),
  zValidator('json', createZoneRequestSchema),
  async (c) => {
    const body = c.req.valid('json');
    const { adminId } = adminOf(c.get('auth'));

    const zone = await repositories.zones.insert({
      name: body.name,
      kind: body.kind,
      geom: body.geom,
      areaId: body.areaId ?? null,
    });

    await repositories.audit.append({
      adminId,
      action: 'zone.create',
      entity: 'zone',
      entityId: zone.id,
      payload: { name: zone.name, kind: zone.kind },
    });
    publishEvent({ type: 'zone.changed', zoneId: zone.id, kind: zone.kind, action: 'created' });

    return c.json(zone, 201);
  },
);

adminRoutes.patch(
  '/zones/:id',
  requireAdminRole('operator'),
  zValidator('json', updateZoneRequestSchema),
  async (c) => {
    const body = c.req.valid('json');
    const { adminId } = adminOf(c.get('auth'));

    const zone = await repositories.zones.update(c.req.param('id'), {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.kind === undefined ? {} : { kind: body.kind }),
      ...(body.geom === undefined ? {} : { geom: body.geom }),
      ...(body.areaId === undefined ? {} : { areaId: body.areaId }),
    });
    if (zone === null) throw notFound('No such zone');

    await repositories.audit.append({
      adminId,
      action: 'zone.update',
      entity: 'zone',
      entityId: zone.id,
      payload: body,
    });
    publishEvent({ type: 'zone.changed', zoneId: zone.id, kind: zone.kind, action: 'updated' });

    return c.json(zone);
  },
);

adminRoutes.delete('/zones/:id', requireAdminRole('operator'), async (c) => {
  const id = c.req.param('id');
  const { adminId } = adminOf(c.get('auth'));

  const zone = await repositories.zones.findById(id);
  if (zone === null) throw notFound('No such zone');

  await repositories.zones.delete(id);
  await repositories.audit.append({
    adminId,
    action: 'zone.delete',
    entity: 'zone',
    entityId: id,
    payload: { name: zone.name, kind: zone.kind },
  });
  publishEvent({ type: 'zone.changed', zoneId: id, kind: zone.kind, action: 'deleted' });

  return c.json({ ok: true });
});

// --- plans & pricing -----------------------------------------------------

adminRoutes.get('/plans', async (c) => {
  const items = await repositories.plans.listAll();
  return c.json({ items, total: items.length });
});

adminRoutes.post(
  '/plans',
  requireAdminRole('operator'),
  zValidator('json', createPlanRequestSchema),
  async (c) => {
    const body = c.req.valid('json');
    const { adminId } = adminOf(c.get('auth'));

    const [plan] = await repositories.plans.insertMany([body]);
    if (plan === undefined) throw new Error('Failed to create plan');

    await repositories.audit.append({
      adminId,
      action: 'plan.create',
      entity: 'plan',
      entityId: plan.id,
      payload: body,
    });
    return c.json(plan, 201);
  },
);

adminRoutes.patch(
  '/plans/:id',
  requireAdminRole('operator'),
  zValidator('json', updatePlanRequestSchema),
  async (c) => {
    const body = c.req.valid('json');
    const { adminId } = adminOf(c.get('auth'));

    const plan = await repositories.plans.update(c.req.param('id'), body);
    if (plan === null) throw notFound('No such plan');

    await repositories.audit.append({
      adminId,
      action: 'plan.update',
      entity: 'plan',
      entityId: plan.id,
      payload: body,
    });
    return c.json(plan);
  },
);

// --- vehicle control -----------------------------------------------------

adminRoutes.patch(
  '/vehicles/:id/status',
  requireAdminRole('operator'),
  zValidator(
    'json',
    z.object({ status: z.enum(['available', 'offline', 'maintenance', 'low_battery']) }),
  ),
  async (c) => {
    const id = c.req.param('id');
    const { status } = c.req.valid('json');
    const { adminId } = adminOf(c.get('auth'));

    const vehicle = await repositories.vehicles.findById(id);
    if (vehicle === null) throw notFound('No such vehicle');

    await repositories.vehicles.updateStatus(id, status);
    await repositories.audit.append({
      adminId,
      action: 'vehicle.status_change',
      entity: 'vehicle',
      entityId: id,
      payload: { from: vehicle.status, to: status },
    });
    publishEvent({
      type: 'vehicle.updated',
      vehicleId: id,
      status,
      batteryPct: vehicle.batteryPct,
      location: vehicle.location,
    });

    return c.json({ ok: true, status });
  },
);
