import { RENTAL_DURATIONS, somToTiyin } from '@ozothunder/shared';
import { closeDatabase } from '../db/client.js';
import { hashSecret } from '../lib/password.js';
import { logError, write } from '../lib/logger.js';
import { repositories } from '../repositories/index.js';
import {
  FORBIDDEN_ZONES,
  PARKING_ZONES,
  SERVICE_AREA,
  SLOW_ZONES,
  zonePolygon,
} from './geo-data.js';
import { SIMULATOR_RIDER_COUNT, simulatorRiderPhone } from './riders.js';

/**
 * Seeds the demo dataset: the city, its zones, the tariffs, and the owner
 * account. Deterministic, so a rehearsed demo stays rehearsed.
 *
 * **It creates no vehicles.** There used to be seventy of them scattered around
 * Bukhara, which was the right answer while the fleet was imaginary and the
 * wrong one now that real scooters are going into it. A vehicle is a physical
 * object with a QR sticker and an IMEI, so it enters the system the way the
 * physical object does: an operator adds it from Самокаты, reading the numbers
 * off the scooter in front of them. Only vehicles ticked «Симулировать» are
 * driven by the fleet simulator.
 *
 * Run with `pnpm db:seed`.
 */

const ADMIN_EMAIL = 'admin@demo.uz';
const ADMIN_PASSWORD = 'demo1234';

async function main(): Promise<void> {
  write('Seeding Ozo Thunder demo data…');
  await repositories.maintenance.truncateAll();

  // --- area + zones ------------------------------------------------------
  const area = await repositories.areas.insert({ name: 'Bukhara', geom: SERVICE_AREA });

  const zones = await repositories.zones.insertMany([
    {
      name: 'Bukhara service area',
      kind: 'service',
      geom: SERVICE_AREA,
      areaId: area.id,
      speedLimitKph: null,
    },
    ...PARKING_ZONES.map((zone) => ({
      name: zone.name,
      kind: 'parking' as const,
      geom: zonePolygon(zone),
      areaId: area.id,
      speedLimitKph: null,
    })),
    ...FORBIDDEN_ZONES.map((zone) => ({
      name: zone.name,
      kind: 'forbidden' as const,
      geom: zonePolygon(zone),
      areaId: area.id,
      speedLimitKph: null,
    })),
    ...SLOW_ZONES.map((zone) => ({
      name: zone.name,
      kind: 'slow' as const,
      geom: zonePolygon(zone),
      areaId: area.id,
      speedLimitKph: zone.speedLimitKph,
    })),
  ]);

  // --- plans -------------------------------------------------------------
  // Three rents the app sells outright, and one it does not: `officeOnly` is
  // the only thing that separates a week from three hours, and it is what
  // `GET /catalog/plans` filters on.
  const plans = await repositories.plans.insertMany([
    {
      kind: 'per_minute',
      name: 'Поминутный',
      unlockFee: somToTiyin(3000),
      price: somToTiyin(1000),
      durationMinutes: null,
      officeOnly: false,
    },
    {
      kind: 'rental',
      name: 'Аренда на 3 часа',
      unlockFee: 0,
      price: somToTiyin(25_000),
      durationMinutes: RENTAL_DURATIONS.threeHours,
      officeOnly: false,
    },
    {
      kind: 'rental',
      name: 'Аренда на 5 часов',
      unlockFee: 0,
      price: somToTiyin(35_000),
      durationMinutes: RENTAL_DURATIONS.fiveHours,
      officeOnly: false,
    },
    {
      kind: 'rental',
      name: 'Аренда на 24 часа',
      unlockFee: 0,
      price: somToTiyin(90_000),
      durationMinutes: RENTAL_DURATIONS.day,
      officeOnly: false,
    },
    {
      kind: 'rental',
      name: 'Аренда на неделю',
      unlockFee: 0,
      price: somToTiyin(250_000),
      durationMinutes: RENTAL_DURATIONS.week,
      officeOnly: true,
    },
  ]);

  // --- admin -------------------------------------------------------------
  // The owner. It passes every permission check on its own and is the only
  // account that can create the others, so it carries no permissions map.
  await repositories.admins.insertMany([
    {
      email: ADMIN_EMAIL,
      passwordHash: await hashSecret(ADMIN_PASSWORD),
      role: 'owner',
      permissions: {},
    },
  ]);

  // Riders reserved for the fleet simulator. A rider may only have one ride in
  // flight (enforced by a partial unique index), so simulated rides need their
  // own accounts — otherwise they occupy the demo accounts and whoever logs in
  // for the demo starts with a phantom ride already in progress.
  await repositories.users.insertMany(
    Array.from({ length: SIMULATOR_RIDER_COUNT }, (_, index) => ({
      phone: simulatorRiderPhone(index),
      name: `Симуляция ${index + 1}`,
      balance: 0,
    })),
  );

  // --- verify ------------------------------------------------------------
  const vehicleCount = await repositories.vehicles.count();
  if (vehicleCount !== 0) {
    throw new Error(`Expected an empty fleet after truncation, found ${String(vehicleCount)}`);
  }

  const parkingCount = zones.filter((z) => z.kind === 'parking').length;
  const forbiddenCount = zones.filter((z) => z.kind === 'forbidden').length;
  const slowCount = zones.filter((z) => z.kind === 'slow').length;

  write('');
  write(`  Area          ${area.name}`);
  write(
    `  Zones         ${parkingCount} parking, ${forbiddenCount} forbidden, ` +
      `${slowCount} slow, 1 service area`,
  );
  write(`  Plans         ${plans.map((p) => p.name).join(', ')}`);
  write('  Vehicles      none — add real scooters from Самокаты in the back office');
  write(`  Admin         ${ADMIN_EMAIL} / ${ADMIN_PASSWORD} (owner)`);
  write(
    `  Riders        ${SIMULATOR_RIDER_COUNT} reserved for the simulator (real users sign up themselves)`,
  );
  write('');
  write('Seed complete.');
}

main()
  .then(async () => {
    await closeDatabase();
  })
  .catch(async (error: unknown) => {
    logError('Seed failed', error);
    await closeDatabase();
    process.exitCode = 1;
  });
