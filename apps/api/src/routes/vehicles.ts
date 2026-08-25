import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  API_ERROR_CODES,
  createVehicleRequestSchema,
  listVehiclesQuerySchema,
  qrCodeSchema,
  updateVehicleRequestSchema,
  type AdminVehicle,
  type Vehicle,
} from '@ozothunder/shared';
import { getSimulationControl } from '../gateway/index.js';
import { conflict, notFound } from '../lib/errors.js';
import { logWarn } from '../lib/logger.js';
import { repositories } from '../repositories/index.js';
import {
  adminOf,
  requireAdmin,
  requirePermission,
  requireRider,
  riderIdOf,
  type AppEnv,
} from '../middleware/auth.js';
import {
  findActiveHold,
  releaseExpiredReservations,
  releaseVehicle,
  reserveVehicle,
} from '../services/reservations.js';

/** Rider-facing vehicle reads. */
export const vehicleRoutes = new Hono<AppEnv>();

vehicleRoutes.get(
  '/',
  requireRider,
  zValidator('query', listVehiclesQuerySchema),
  async (c) => {
    const query = c.req.valid('query');
    const riderId = riderIdOf(c.get('auth'));
    // The map is polled every 5 s, which makes it the natural place to sweep
    // lapsed holds — no scheduler, and a hold can never outlive its expiry by
    // more than one poll.
    await releaseExpiredReservations(repositories);
    const items: Vehicle[] = await repositories.vehicles.listPublic(query, riderId);
    return c.json({ items, total: items.length });
  },
);

/** The rider's live hold, if they have one. Drives the countdown banner. */
vehicleRoutes.get('/reservation', requireRider, async (c) => {
  const hold = await findActiveHold(repositories, riderIdOf(c.get('auth')));
  return c.json({ reservation: hold });
});

vehicleRoutes.post('/:id/reserve', requireRider, async (c) => {
  const vehicle = await reserveVehicle(repositories, {
    userId: riderIdOf(c.get('auth')),
    vehicleId: c.req.param('id'),
  });
  return c.json(vehicle satisfies Vehicle, 201);
});

vehicleRoutes.delete('/:id/reserve', requireRider, async (c) => {
  await releaseVehicle(repositories, {
    userId: riderIdOf(c.get('auth')),
    vehicleId: c.req.param('id'),
  });
  return c.body(null, 204);
});

vehicleRoutes.get('/by-qr/:qrCode', requireRider, async (c) => {
  const parsed = qrCodeSchema.safeParse(c.req.param('qrCode'));
  if (!parsed.success) throw notFound('No vehicle with that QR code');

  const vehicle = await repositories.vehicles.findByQrCode(parsed.data);
  if (vehicle === null) throw notFound('No vehicle with that QR code');

  // Riders never see hardware identity.
  const { imei: _imei, ...publicVehicle } = vehicle;
  return c.json(publicVehicle satisfies Vehicle);
});

vehicleRoutes.get('/:id', requireRider, async (c) => {
  const vehicle = await repositories.vehicles.findById(c.req.param('id'));
  if (vehicle === null) throw notFound('No such vehicle');

  const { imei: _imei, ...publicVehicle } = vehicle;
  return c.json(publicVehicle satisfies Vehicle);
});

/** Back-office vehicle reads — includes IMEI and non-public statuses. */
export const adminVehicleRoutes = new Hono<AppEnv>();

adminVehicleRoutes.get(
  '/',
  requireAdmin,
  requirePermission('vehicles', 'view'),
  zValidator('query', listVehiclesQuerySchema),
  async (c) => {
    const items: AdminVehicle[] = await repositories.vehicles.listAll(c.req.valid('query'));
    return c.json({ items, total: items.length });
  },
);

adminVehicleRoutes.get('/stats', requireAdmin, requirePermission('vehicles', 'view'), async (c) => {
  const counts = await repositories.vehicles.countByStatus();
  const total = await repositories.vehicles.count();
  return c.json({ total, byStatus: counts });
});

adminVehicleRoutes.get('/:id', requireAdmin, requirePermission('vehicles', 'view'), async (c) => {
  const vehicle = await repositories.vehicles.findById(c.req.param('id'));
  if (vehicle === null) throw notFound('No such vehicle');
  return c.json(vehicle);
});

/**
 * Put a real scooter into the fleet.
 *
 * The seed creates none, so this is how the fleet exists at all. `areaId` is
 * resolved rather than asked for: there is one service area, the operator is
 * standing in it, and making them pick it from a dropdown of one would be a
 * question with no answer worth having.
 */
adminVehicleRoutes.post(
  '/',
  requireAdmin,
  requirePermission('vehicles', 'manage'),
  zValidator('json', createVehicleRequestSchema),
  async (c) => {
    const body = c.req.valid('json');
    const { adminId } = adminOf(c.get('auth'));

    await requireUnusedIdentity(body.qrCode, body.imei, null);

    const [area] = await repositories.areas.list();
    const vehicle = await repositories.vehicles.insert({ ...body, areaId: area?.id ?? null });

    await repositories.audit.append({
      adminId,
      action: 'vehicle.create',
      entity: 'vehicle',
      entityId: vehicle.id,
      payload: { qrCode: vehicle.qrCode, imei: vehicle.imei, simulated: vehicle.simulated },
    });

    await refreshSimulatedFleet();
    return c.json(vehicle satisfies AdminVehicle, 201);
  },
);

adminVehicleRoutes.patch(
  '/:id',
  requireAdmin,
  requirePermission('vehicles', 'manage'),
  zValidator('json', updateVehicleRequestSchema),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const { adminId } = adminOf(c.get('auth'));

    const existing = await repositories.vehicles.findById(id);
    if (existing === null) throw notFound('No such vehicle');

    await requireUnusedIdentity(body.qrCode, body.imei, id);

    const vehicle = await repositories.vehicles.update(id, body);
    if (vehicle === null) throw notFound('No such vehicle');

    await repositories.audit.append({
      adminId,
      action: 'vehicle.update',
      entity: 'vehicle',
      entityId: vehicle.id,
      payload: { qrCode: vehicle.qrCode, changed: Object.keys(body) },
    });

    await refreshSimulatedFleet();
    return c.json(vehicle satisfies AdminVehicle);
  },
);

/**
 * Remove a scooter from the fleet.
 *
 * Refused in two cases, and the second is the one that matters.
 *
 * While somebody is using it: a ride or a rental references this row and the
 * rider is standing next to the thing.
 *
 * And once it has *ever* been ridden. `rides.vehicle_id` is `restrict`, not
 * cascade — deliberately, because a ride is a financial record and its receipt
 * has to keep resolving. So a scooter with history cannot be deleted at all;
 * the honest way to retire one is `maintenance`, which takes it off the rider
 * map and leaves every past receipt intact. Without this check the delete
 * reached Postgres and came back as an opaque 500.
 */
adminVehicleRoutes.delete(
  '/:id',
  requireAdmin,
  requirePermission('vehicles', 'manage'),
  async (c) => {
    const id = c.req.param('id');
    const { adminId } = adminOf(c.get('auth'));

    const vehicle = await repositories.vehicles.findById(id);
    if (vehicle === null) throw notFound('No such vehicle');

    const ride = await repositories.rides.findActiveByVehicle(id);
    if (ride !== null) {
      throw conflict(API_ERROR_CODES.VEHICLE_UNAVAILABLE, 'This scooter is out on a ride');
    }
    const subscription = await repositories.subscriptions.findActiveForVehicle(id);
    if (subscription !== null) {
      throw conflict(
        API_ERROR_CODES.VEHICLE_UNAVAILABLE,
        'This scooter is on an active rental — end it first',
      );
    }

    const rides = await repositories.rides.countByVehicle(id);
    if (rides > 0) {
      throw conflict(
        API_ERROR_CODES.CONFLICT,
        `This scooter has ${String(rides)} ride(s) in its history, which receipts still refer to. ` +
          'Set it to «Обслуживание» to take it off the map instead of deleting it.',
      );
    }

    const removed = await repositories.vehicles.remove(id);
    if (!removed) throw notFound('No such vehicle');

    await repositories.audit.append({
      adminId,
      action: 'vehicle.delete',
      entity: 'vehicle',
      entityId: id,
      payload: { qrCode: vehicle.qrCode, imei: vehicle.imei },
    });

    await refreshSimulatedFleet();
    return c.json({ id });
  },
);

/**
 * Both columns are uniquely indexed, so the database would refuse a duplicate
 * anyway — as an opaque 500. Checking first turns it into the 409 the form can
 * actually put next to the field.
 */
async function requireUnusedIdentity(
  qrCode: string | undefined,
  imei: string | undefined,
  selfId: string | null,
): Promise<void> {
  if (qrCode !== undefined) {
    const clash = await repositories.vehicles.findByQrCode(qrCode);
    if (clash !== null && clash.id !== selfId) {
      throw conflict(API_ERROR_CODES.CONFLICT, `QR code ${qrCode} is already on another scooter`);
    }
  }
  if (imei !== undefined) {
    const clash = await repositories.vehicles.findByImei(imei);
    if (clash !== null && clash.id !== selfId) {
      throw conflict(API_ERROR_CODES.CONFLICT, `IMEI ${imei} is already on another scooter`);
    }
  }
}

/**
 * Tell the simulator the fleet changed, so a scooter ticked «Симулировать»
 * starts moving without a restart.
 *
 * Best effort on purpose: the vehicle is already written, and a simulator that
 * is down — or absent entirely, which is what `null` means on real hardware —
 * must not turn a successful create into an error. It picks the vehicle up on
 * its next load either way.
 */
async function refreshSimulatedFleet(): Promise<void> {
  const control = getSimulationControl();
  if (control === null) return;
  try {
    await control.resetFleet();
  } catch (cause) {
    logWarn(
      `Could not refresh the simulated fleet (${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }
}
