import {
  FLEET_SIZE,
  LOW_BATTERY_THRESHOLD_PCT,
  TASHKENT_CLUSTERS,
  somToTiyin,
  type LatLon,
  type VehicleStatus,
} from '@scoot/shared';
import { closeDatabase } from '../db/client.js';
import { hashSecret } from '../lib/password.js';
import { logError, write } from '../lib/logger.js';
import { repositories } from '../repositories/index.js';
import type { NewVehicle } from '../repositories/vehicles.js';
import {
  CLUSTER_STREETS,
  FORBIDDEN_ZONES,
  PARKING_ZONES,
  SERVICE_AREA,
  VEHICLE_MODELS,
  zonePolygon,
} from './geo-data.js';
import { mulberry32, randomInt, scatterAlongLine, scatterInDisc, type Rng } from './random.js';
import { SIMULATOR_RIDER_COUNT, simulatorRiderPhone } from './riders.js';

/**
 * Seeds the demo dataset. Deterministic: the same 70 vehicles land in the same
 * places every run, so a rehearsed demo stays rehearsed.
 *
 * Run with `pnpm db:seed`.
 */

const SEED = 20_260_728;

const ADMIN_EMAIL = 'admin@demo.uz';
const ADMIN_PASSWORD = 'demo1234';

/**
 * Status spread, 70 vehicles total. Deliberately not all-available: the map
 * should show a fleet with real problems in it.
 */
const STATUS_SPREAD: ReadonlyArray<{ status: VehicleStatus; count: number }> = [
  { status: 'available', count: 55 },
  { status: 'low_battery', count: 6 },
  { status: 'offline', count: 4 },
  { status: 'maintenance', count: 3 },
  { status: 'in_use', count: 2 },
];

function batteryFor(status: VehicleStatus, rng: Rng): number {
  switch (status) {
    case 'low_battery':
      return randomInt(rng, 4, LOW_BATTERY_THRESHOLD_PCT - 1);
    case 'in_use':
      return randomInt(rng, 45, 92);
    case 'maintenance':
      return randomInt(rng, 10, 80);
    case 'offline':
      return randomInt(rng, 0, 60);
    case 'available':
    case 'reserved':
      return randomInt(rng, 35, 100);
  }
}

/** Deterministic 15-digit IMEI, TAC-prefixed so it looks like real hardware. */
function imeiFor(index: number): string {
  return `8635${(1_000_000_000 + index * 7919).toString().padStart(11, '0')}`.slice(0, 15);
}

function qrCodeFor(index: number): string {
  return `SCOOT-${(index + 1).toString().padStart(4, '0')}`;
}

/**
 * Distributes the fleet across clusters by weight. Roughly a third of each
 * cluster is laid along a street segment and the rest scattered in a disc.
 */
function placeVehicles(rng: Rng): LatLon[] {
  const positions: LatLon[] = [];

  const totalWeight = TASHKENT_CLUSTERS.reduce((sum, cluster) => sum + cluster.weight, 0);
  let assigned = 0;

  TASHKENT_CLUSTERS.forEach((cluster, index) => {
    const isLast = index === TASHKENT_CLUSTERS.length - 1;
    const share = isLast
      ? FLEET_SIZE - assigned
      : Math.round((cluster.weight / totalWeight) * FLEET_SIZE);
    assigned += share;

    const centre: LatLon = { lat: cluster.lat, lon: cluster.lon };
    const street = CLUSTER_STREETS[cluster.name];

    for (let i = 0; i < share; i += 1) {
      const alongStreet = street !== undefined && rng() < 0.35;
      positions.push(
        alongStreet
          ? scatterAlongLine(street.from, street.to, 25, rng)
          : scatterInDisc(centre, cluster.radiusM, rng),
      );
    }
  });

  return positions;
}

function buildFleet(rng: Rng, areaId: string): NewVehicle[] {
  const positions = placeVehicles(rng);

  const statuses: VehicleStatus[] = [];
  for (const { status, count } of STATUS_SPREAD) {
    for (let i = 0; i < count; i += 1) statuses.push(status);
  }
  if (statuses.length !== FLEET_SIZE) {
    throw new Error(`Status spread totals ${statuses.length}, expected ${FLEET_SIZE}`);
  }

  // Shuffle so the non-available vehicles are spread across the city rather
  // than all landing in whichever cluster was filled last.
  for (let i = statuses.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = statuses[i];
    const b = statuses[j];
    if (a === undefined || b === undefined) continue;
    statuses[i] = b;
    statuses[j] = a;
  }

  return positions.map((location, index) => {
    const status = statuses[index] ?? 'available';
    const model = VEHICLE_MODELS[index % VEHICLE_MODELS.length] ?? 'Ninebot Max G30';
    return {
      qrCode: qrCodeFor(index),
      imei: imeiFor(index),
      model,
      status,
      batteryPct: batteryFor(status, rng),
      location,
      areaId,
    };
  });
}

async function main(): Promise<void> {
  const rng = mulberry32(SEED);

  write('Seeding Scoot demo data…');
  await repositories.maintenance.truncateAll();

  // --- area + zones ------------------------------------------------------
  const area = await repositories.areas.insert({ name: 'Tashkent', geom: SERVICE_AREA });

  const zones = await repositories.zones.insertMany([
    { name: 'Tashkent service area', kind: 'service', geom: SERVICE_AREA, areaId: area.id },
    ...PARKING_ZONES.map((zone) => ({
      name: zone.name,
      kind: 'parking' as const,
      geom: zonePolygon(zone),
      areaId: area.id,
    })),
    ...FORBIDDEN_ZONES.map((zone) => ({
      name: zone.name,
      kind: 'forbidden' as const,
      geom: zonePolygon(zone),
      areaId: area.id,
    })),
  ]);

  // --- plans -------------------------------------------------------------
  const plans = await repositories.plans.insertMany([
    {
      kind: 'per_minute',
      name: 'Поминутный',
      unlockFee: somToTiyin(3000),
      price: somToTiyin(1000),
      durationDays: null,
    },
    {
      kind: 'daily',
      name: 'Дневной абонемент',
      unlockFee: 0,
      price: somToTiyin(45_000),
      durationDays: 1,
    },
    {
      kind: 'weekly',
      name: 'Недельный абонемент',
      unlockFee: 0,
      price: somToTiyin(250_000),
      durationDays: 7,
    },
  ]);

  // --- fleet -------------------------------------------------------------
  await repositories.vehicles.insertMany(buildFleet(rng, area.id));

  // --- admin -------------------------------------------------------------
  await repositories.admins.insertMany([
    { email: ADMIN_EMAIL, passwordHash: await hashSecret(ADMIN_PASSWORD), role: 'owner' },
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
  const byStatus = await repositories.vehicles.countByStatus();
  const outside = await repositories.maintenance.countVehiclesOutsideServiceArea();

  if (vehicleCount !== FLEET_SIZE) {
    throw new Error(`Expected ${FLEET_SIZE} vehicles, found ${vehicleCount}`);
  }
  if (outside > 0) {
    throw new Error(`${outside} vehicles landed outside the service area`);
  }

  const parkingCount = zones.filter((z) => z.kind === 'parking').length;
  const forbiddenCount = zones.filter((z) => z.kind === 'forbidden').length;

  write('');
  write(`  Area          ${area.name}`);
  write(`  Zones         ${parkingCount} parking, ${forbiddenCount} forbidden, 1 service area`);
  write(`  Plans         ${plans.map((p) => p.name).join(', ')}`);
  write(`  Vehicles      ${vehicleCount} (all inside the service area)`);
  write(
    `                ${byStatus.available} available · ${byStatus.low_battery} low battery · ` +
      `${byStatus.offline} offline · ${byStatus.maintenance} maintenance · ${byStatus.in_use} in use`,
  );
  write(`  QR codes      ${qrCodeFor(0)} … ${qrCodeFor(FLEET_SIZE - 1)}`);
  write(`  Admin         ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  write(`  Riders        ${SIMULATOR_RIDER_COUNT} reserved for the simulator (real users sign up themselves)`);
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
