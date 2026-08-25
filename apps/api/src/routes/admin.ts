import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { streamSSE } from 'hono/streaming';
import {
  API_ERROR_CODES,
  createPlanRequestSchema,
  createZoneRequestSchema,
  grantSubscriptionRequestSchema,
  listAuditLogQuerySchema,
  listRidesQuerySchema,
  listUsersQuerySchema,
  listZonesQuerySchema,
  updatePlanRequestSchema,
  updateZoneRequestSchema,
  type DashboardStats,
  type RevenuePoint,
} from '@ozothunder/shared';
import { env } from '../env.js';
import { publishEvent, serverEvents } from '../events/bus.js';
import { conflict, notFound } from '../lib/errors.js';
import { repositories } from '../repositories/index.js';
import { isSimulatorRider } from '../seed/riders.js';
import { forceEndRide } from '../services/rides.js';
import {
  cancelSubscription,
  expireLapsedSubscriptions,
  grantSubscription,
} from '../services/subscriptions.js';
import { adminOf, requireAdmin, requirePermission, type AppEnv } from '../middleware/auth.js';

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

  // On Workers the event hub lives in the FleetSimulator DO — hand the
  // (already authenticated) connection to it and stream its response back.
  if (env.VEHICLE_GATEWAY === 'durable') {
    const bindings = c.env as { fleetStub?: { fetch: (r: Request) => Promise<Response> } };
    if (bindings.fleetStub === undefined) {
      return c.json({ error: { code: 'internal', message: 'Fleet stub missing' } }, 500);
    }
    const upstream = await bindings.fleetStub.fetch(new Request('https://fleet/events'));
    return new Response(upstream.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
      },
    });
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

adminRoutes.get('/stats', requirePermission('dashboard', 'view'), async (c) => {
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

adminRoutes.get('/revenue', requirePermission('dashboard', 'view'), async (c) => {
  const days = Number.parseInt(c.req.query('days') ?? '14', 10);
  const items: RevenuePoint[] = await repositories.rides.revenueByDay(
    Number.isFinite(days) ? Math.min(90, Math.max(1, days)) : 14,
  );
  return c.json({ items, total: items.length });
});

// --- tables --------------------------------------------------------------

adminRoutes.get(
  '/rides',
  requirePermission('rides', 'view'),
  zValidator('query', listRidesQuerySchema),
  async (c) => {
  const items = await repositories.rides.listAll(c.req.valid('query'));
  return c.json({ items, total: items.length });
});

/**
 * Operator force-end for stuck or abandoned rides. Settles wherever the
 * vehicle is (no parking check) and charges the rider for the time used.
 */
adminRoutes.post('/rides/:id/end', requirePermission('rides', 'manage'), async (c) => {
  const { adminId } = adminOf(c.get('auth'));

  const outcome = await forceEndRide(repositories, c.req.param('id'));

  await repositories.audit.append({
    adminId,
    action: 'ride.force_end',
    entity: 'ride',
    entityId: outcome.receipt.ride.id,
    payload: {
      cost: outcome.receipt.breakdown.total,
      durationS: outcome.receipt.breakdown.durationS,
    },
  });

  return c.json(outcome.receipt);
});

adminRoutes.get(
  '/users',
  requirePermission('users', 'view'),
  zValidator('query', listUsersQuerySchema),
  async (c) => {
  // The simulator's reserved rider accounts are plumbing, not customers.
  const items = (await repositories.users.listAll(c.req.valid('query'))).filter(
    (user) => user.phone === null || !isSimulatorRider(user.phone),
  );
  return c.json({ items, total: items.length });
});

// --- rentals -------------------------------------------------------------

adminRoutes.get('/subscriptions', requirePermission('subscriptions', 'view'), async (c) => {
  // Same lazy sweep the rider's poll runs, so a lapsed rental never sits in
  // this table looking active.
  await expireLapsedSubscriptions(repositories);
  const items = await repositories.subscriptions.listAll();
  return c.json({ items, total: items.length });
});

/**
 * Turn rent on for a rider who paid at the office.
 *
 * This is the only way an office-only rental comes into being — the app cannot
 * sell one. Whoever runs this has the customer standing in front of them,
 * which is why the audit row records the operator, the rider and the scooter
 * together.
 */
adminRoutes.post(
  '/subscriptions',
  requirePermission('subscriptions', 'manage'),
  zValidator('json', grantSubscriptionRequestSchema),
  async (c) => {
    const body = c.req.valid('json');
    const { adminId } = adminOf(c.get('auth'));

    const { subscription } = await grantSubscription(repositories, body);

    await repositories.audit.append({
      adminId,
      action: 'subscription.grant',
      entity: 'subscription',
      entityId: subscription.id,
      payload: {
        userId: subscription.userId,
        vehicleId: subscription.vehicleId,
        planId: subscription.planId,
        expiresAt: subscription.expiresAt,
      },
    });

    return c.json({ subscription }, 201);
  },
);

/** End a rental early — the rider brought the scooter back to the office. */
adminRoutes.delete('/subscriptions/:id', requirePermission('subscriptions', 'manage'), async (c) => {
  const { adminId } = adminOf(c.get('auth'));
  const { subscription } = await cancelSubscription(repositories, c.req.param('id'));

  await repositories.audit.append({
    adminId,
    action: 'subscription.cancel',
    entity: 'subscription',
    entityId: subscription.id,
    payload: { userId: subscription.userId, vehicleId: subscription.vehicleId },
  });

  return c.json({ subscription });
});

adminRoutes.get('/payments', requirePermission('subscriptions', 'view'), async (c) => {
  const items = await repositories.payments.listAll();
  return c.json({ items, total: items.length });
});

adminRoutes.get('/commands', requirePermission('vehicles', 'view'), async (c) => {
  const items = await repositories.commands.listRecent(100);
  return c.json({ items, total: items.length });
});

adminRoutes.get(
  '/audit',
  requirePermission('audit', 'view'),
  zValidator('query', listAuditLogQuerySchema),
  async (c) => {
  const items = await repositories.audit.list(c.req.valid('query'));
  return c.json({ items, total: items.length });
});

// --- zones (demo step 7) -------------------------------------------------

adminRoutes.get(
  '/zones',
  requirePermission('zones', 'view'),
  zValidator('query', listZonesQuerySchema),
  async (c) => {
  const items = await repositories.zones.list(c.req.valid('query'));
  return c.json({ items, total: items.length });
});

adminRoutes.post(
  '/zones',
  requirePermission('zones', 'manage'),
  zValidator('json', createZoneRequestSchema),
  async (c) => {
    const body = c.req.valid('json');
    const { adminId } = adminOf(c.get('auth'));

    const zone = await repositories.zones.insert({
      name: body.name,
      kind: body.kind,
      geom: body.geom,
      areaId: body.areaId ?? null,
      speedLimitKph: body.speedLimitKph ?? null,
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
  requirePermission('zones', 'manage'),
  zValidator('json', updateZoneRequestSchema),
  async (c) => {
    const body = c.req.valid('json');
    const { adminId } = adminOf(c.get('auth'));

    const zone = await repositories.zones.update(c.req.param('id'), {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.kind === undefined ? {} : { kind: body.kind }),
      ...(body.geom === undefined ? {} : { geom: body.geom }),
      ...(body.areaId === undefined ? {} : { areaId: body.areaId }),
      // A kind change away from `slow` must clear the limit, or the row keeps
      // a cap that no longer applies to anything.
      ...(body.speedLimitKph === undefined
        ? body.kind === undefined || body.kind === 'slow'
          ? {}
          : { speedLimitKph: null }
        : { speedLimitKph: body.speedLimitKph }),
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

adminRoutes.delete('/zones/:id', requirePermission('zones', 'manage'), async (c) => {
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

adminRoutes.get('/plans', requirePermission('plans', 'view'), async (c) => {
  const items = await repositories.plans.listAll();
  return c.json({ items, total: items.length });
});

adminRoutes.post(
  '/plans',
  requirePermission('plans', 'manage'),
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
  requirePermission('plans', 'manage'),
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

/**
 * Remove a tariff.
 *
 * Refused once anything references it: `rides.plan_id` is `restrict` because a
 * receipt has to keep resolving, and a subscription names the terms it was
 * sold on. Switching the plan off (`active: false`) is the remedy — it leaves
 * the app's tariff list and the grant modal while every past ride keeps its
 * price. Without this check the delete reached Postgres as an opaque 500.
 */
adminRoutes.delete('/plans/:id', requirePermission('plans', 'manage'), async (c) => {
  const id = c.req.param('id');
  const { adminId } = adminOf(c.get('auth'));

  const plan = await repositories.plans.findById(id);
  if (plan === null) throw notFound('No such plan');

  const used = await repositories.plans.countUsages(id);
  if (used > 0) {
    throw conflict(
      API_ERROR_CODES.CONFLICT,
      `«${plan.name}» is referenced by ${String(used)} ride(s) or rental(s). ` +
        'Switch it off instead — it disappears from the app and history keeps its prices.',
    );
  }

  await repositories.plans.remove(id);
  await repositories.audit.append({
    adminId,
    action: 'plan.delete',
    entity: 'plan',
    entityId: id,
    payload: { name: plan.name, durationMinutes: plan.durationMinutes },
  });

  return c.json({ id });
});

// --- vehicle control -----------------------------------------------------

adminRoutes.patch(
  '/vehicles/:id/status',
  requirePermission('vehicles', 'manage'),
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
