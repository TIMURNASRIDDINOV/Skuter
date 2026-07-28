import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  endRideRequestSchema,
  latLonSchema,
  startRideRequestSchema,
  type ParkingCheck,
  type Ride,
} from '@scoot/shared';
import { publishEvent } from '../events/bus.js';
import { getVehicleGateway } from '../gateway/index.js';
import { notFound } from '../lib/errors.js';
import { repositories } from '../repositories/index.js';
import { requireRider, riderIdOf, type AppEnv } from '../middleware/auth.js';
import { checkParking } from '../services/parking.js';
import { buildReceipt, endRide, getActiveRide, startRide } from '../services/rides.js';

export const rideRoutes = new Hono<AppEnv>();

/** Demo step 2 — scan a QR and unlock. Fails ~8% of the time, by design. */
rideRoutes.post('/', requireRider, zValidator('json', startRideRequestSchema), async (c) => {
  const { qrCode, planId } = c.req.valid('json');
  const result = await startRide(repositories, {
    userId: riderIdOf(c.get('auth')),
    qrCode,
    planId,
  });
  return c.json(result, 201);
});

rideRoutes.get('/active', requireRider, async (c) => {
  const ride = await getActiveRide(repositories, riderIdOf(c.get('auth')));
  return c.json({ ride });
});

rideRoutes.get('/', requireRider, async (c) => {
  const items: Ride[] = await repositories.rides.listForUser(riderIdOf(c.get('auth')));
  return c.json({ items, total: items.length });
});

/**
 * Pre-flight parking check. The app calls this as the rider moves so the
 * end-ride button can show whether parking here will be accepted, before they
 * tap it.
 */
rideRoutes.post(
  '/check-parking',
  requireRider,
  zValidator('json', z.object({ location: latLonSchema })),
  async (c) => {
    const check: ParkingCheck = await checkParking(repositories, c.req.valid('json').location);
    return c.json(check);
  },
);

/** Demo steps 4 and 5 — refused outside a parking zone, accepted inside one. */
rideRoutes.post(
  '/:id/end',
  requireRider,
  zValidator('json', endRideRequestSchema),
  async (c) => {
    const { receipt } = await endRide(repositories, {
      userId: riderIdOf(c.get('auth')),
      rideId: c.req.param('id'),
      location: c.req.valid('json').location,
    });
    return c.json(receipt);
  },
);

rideRoutes.get('/:id/receipt', requireRider, async (c) => {
  const rideId = c.req.param('id');
  const ride = await repositories.rides.findById(rideId);
  if (ride === null || ride.userId !== riderIdOf(c.get('auth'))) throw notFound('No such ride');

  const planId = await repositories.rides.findPlanId(rideId);
  const plan = planId === null ? null : await repositories.plans.findById(planId);

  // A completed ride's stored cost is authoritative; reconstruct the line
  // items around it rather than repricing against possibly-edited plan rates.
  const chargedMinutes = Math.ceil(ride.durationS / 60);
  const unlockFee = ride.cost === 0 ? 0 : (plan?.unlockFee ?? 0);
  const timeFee = Math.max(0, ride.cost - unlockFee);

  const receipt = await buildReceipt(
    repositories,
    rideId,
    {
      unlockFee,
      ratePerMinute: chargedMinutes === 0 ? 0 : Math.round(timeFee / chargedMinutes),
      chargedMinutes,
      timeFee,
      total: ride.cost,
      durationS: ride.durationS,
      distanceM: ride.distanceM,
      coveredBySubscription: ride.cost === 0,
    },
    ride.endZoneId,
  );
  return c.json(receipt);
});

/** Ring the scooter so a rider can find it. */
rideRoutes.post('/:id/beep', requireRider, async (c) => {
  const ride = await repositories.rides.findById(c.req.param('id'));
  if (ride === null || ride.userId !== riderIdOf(c.get('auth'))) throw notFound('No such ride');

  const result = await getVehicleGateway().beep(ride.vehicleId);
  publishEvent({
    type: 'command.updated',
    commandId: result.commandId,
    vehicleId: ride.vehicleId,
    commandType: 'beep',
    status: result.status,
  });
  return c.json(result);
});

/** Lock mid-ride, e.g. while stopping at a shop. The ride stays open. */
rideRoutes.post('/:id/lock', requireRider, async (c) => {
  const ride = await repositories.rides.findById(c.req.param('id'));
  if (ride === null || ride.userId !== riderIdOf(c.get('auth'))) throw notFound('No such ride');

  const result = await getVehicleGateway().lock(ride.vehicleId);
  publishEvent({
    type: 'command.updated',
    commandId: result.commandId,
    vehicleId: ride.vehicleId,
    commandType: 'lock',
    status: result.status,
  });
  return c.json(result);
});
