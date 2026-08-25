import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { idSchema, vehicleStatusSchema } from '@ozothunder/shared';
import { devFeaturesEnabled, devRoutesSecret, isProduction } from '../env.js';
import { NotImplementedError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { getSimulationControl } from '../gateway/index.js';
import { repositories } from '../repositories/index.js';
import type { AppEnv } from '../middleware/auth.js';
import type { SimulationControl } from '../gateway/types.js';

/**
 * Demo controls for steering fleet state live during a client meeting.
 *
 * Locally they stay unauthenticated so they can be fired from a terminal
 * mid-demo — that is the whole point of them.
 *
 * **On a deployed instance they are not open.** The pre-release deployment
 * runs `NODE_ENV=production` with `DEV_FEATURES=true`, because there is no SMS
 * provider yet and the clients depend on these routes. Left as-is that would
 * put "start a ride on any scooter", "drain any battery" and "take any scooter
 * offline" on a public URL for anyone who guesses it. So in production they
 * additionally require `X-Dev-Secret` to match `DEV_ROUTES_SECRET`, and if
 * that secret is not set they stay off entirely — a deploy cannot expose them
 * by omission.
 */
export const devRoutes = new Hono<AppEnv>();

devRoutes.use('*', async (c, next) => {
  if (!devFeaturesEnabled) {
    throw forbidden('Simulation endpoints are disabled outside development');
  }

  if (isProduction) {
    if (devRoutesSecret === null) {
      throw forbidden('Simulation endpoints require DEV_ROUTES_SECRET to be set');
    }
    if (c.req.header('X-Dev-Secret') !== devRoutesSecret) {
      throw forbidden('Simulation endpoints require a valid X-Dev-Secret header');
    }
  }

  await next();
});

function control(): SimulationControl {
  const simulation = getSimulationControl();
  if (simulation === null) {
    throw new NotImplementedError(
      'The active vehicle gateway does not simulate its fleet, so it cannot be driven from here. Set VEHICLE_GATEWAY=simulated.',
    );
  }
  return simulation;
}

/**
 * Accepts either a vehicle UUID or a QR code, because reading a UUID aloud
 * mid-demo is not a thing anyone wants to do.
 *
 * A vehicle that exists but is not simulated is refused here with a message
 * that says so. Since the seed stopped creating a fleet, that is the ordinary
 * case rather than an impossible one — most scooters in the table are real,
 * and the simulator has never heard of them. Letting it through produced an
 * opaque 500 from inside the gateway, which mid-demo reads as a broken API.
 */
async function resolveSimulatedVehicleId(reference: string): Promise<string> {
  const vehicle = idSchema.safeParse(reference).success
    ? await repositories.vehicles.findById(reference)
    : await repositories.vehicles.findByQrCode(reference.toUpperCase());

  if (vehicle === null) throw notFound(`No vehicle matching ${reference}`);
  if (!vehicle.simulated) {
    throw badRequest(
      `Scooter ${vehicle.qrCode} is real, not simulated — the simulator cannot drive it. ` +
        'Tick «Симулировать» on it in the back office first.',
    );
  }
  return vehicle.id;
}

const vehicleRefSchema = z.object({
  /** Vehicle UUID or QR code, e.g. `000000042`. */
  vehicle: z.string().trim().min(1),
});

devRoutes.get('/simulate/status', async (c) => c.json(await control().snapshot()));

devRoutes.post('/simulate/reset', async (c) => {
  const result = await control().resetFleet();
  return c.json({ ok: true, ...result });
});

devRoutes.post('/simulate/ride', zValidator('json', vehicleRefSchema), async (c) => {
  const vehicleId = await resolveSimulatedVehicleId(c.req.valid('json').vehicle);
  const result = await control().forceRide(vehicleId);
  return c.json({ ok: true, vehicleId, ...result });
});

devRoutes.post(
  '/simulate/battery',
  zValidator(
    'json',
    vehicleRefSchema.extend({
      /** Target percentage. Below 20 flips the vehicle to low_battery. */
      pct: z.number().int().min(0).max(100).default(12),
    }),
  ),
  async (c) => {
    const { vehicle, pct } = c.req.valid('json');
    const vehicleId = await resolveSimulatedVehicleId(vehicle);
    const result = await control().drainBattery(vehicleId, pct);
    return c.json({ ok: true, vehicleId, ...result });
  },
);

devRoutes.post(
  '/simulate/status',
  zValidator('json', vehicleRefSchema.extend({ status: vehicleStatusSchema })),
  async (c) => {
    const { vehicle, status } = c.req.valid('json');
    if (status === 'in_use') {
      throw badRequest('Use POST /dev/simulate/ride to put a vehicle in use');
    }
    const vehicleId = await resolveSimulatedVehicleId(vehicle);
    const result = await control().setStatus(vehicleId, status);
    return c.json({ ok: true, vehicleId, ...result });
  },
);

devRoutes.post('/simulate/offline', zValidator('json', vehicleRefSchema), async (c) => {
  const vehicleId = await resolveSimulatedVehicleId(c.req.valid('json').vehicle);
  const result = await control().setStatus(vehicleId, 'offline');
  return c.json({ ok: true, vehicleId, ...result });
});
