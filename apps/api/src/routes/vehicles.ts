import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  listVehiclesQuerySchema,
  qrCodeSchema,
  type AdminVehicle,
  type Vehicle,
} from '@scoot/shared';
import { notFound } from '../lib/errors.js';
import { repositories } from '../repositories/index.js';
import { requireAdmin, requireRider, type AppEnv } from '../middleware/auth.js';

/** Rider-facing vehicle reads. */
export const vehicleRoutes = new Hono<AppEnv>();

vehicleRoutes.get(
  '/',
  requireRider,
  zValidator('query', listVehiclesQuerySchema),
  async (c) => {
    const query = c.req.valid('query');
    const items: Vehicle[] = await repositories.vehicles.listPublic(query);
    return c.json({ items, total: items.length });
  },
);

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
  zValidator('query', listVehiclesQuerySchema),
  async (c) => {
    const items: AdminVehicle[] = await repositories.vehicles.listAll(c.req.valid('query'));
    return c.json({ items, total: items.length });
  },
);

adminVehicleRoutes.get('/stats', requireAdmin, async (c) => {
  const counts = await repositories.vehicles.countByStatus();
  const total = await repositories.vehicles.count();
  return c.json({ total, byStatus: counts });
});

adminVehicleRoutes.get('/:id', requireAdmin, async (c) => {
  const vehicle = await repositories.vehicles.findById(c.req.param('id'));
  if (vehicle === null) throw notFound('No such vehicle');
  return c.json(vehicle);
});
