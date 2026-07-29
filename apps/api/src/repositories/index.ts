import { db as defaultDb, type Database } from '../db/client.js';
import { createAdminsRepository, createAuditRepository } from './admins.js';
import { createCommandsRepository } from './commands.js';
import { createMaintenanceRepository } from './maintenance.js';
import { createOtpRepository } from './otp.js';
import { createPaymentsRepository } from './payments.js';
import { createPlansRepository } from './plans.js';
import { createRidesRepository } from './rides.js';
import { createSubscriptionsRepository } from './subscriptions.js';
import { createTelegramNoncesRepository } from './telegram-nonces.js';
import { createUsersRepository } from './users.js';
import { createVehiclesRepository } from './vehicles.js';
import { createAreasRepository, createZonesRepository } from './zones.js';

/**
 * The repository registry — the API's entire surface onto the database.
 *
 * Routes, the fleet simulator and the seed script all take repositories, never
 * the Drizzle handle. Repositories are constructed with an injected `Database`
 * so a transaction handle can be passed in and so they can be faked in tests.
 */
export function createRepositories(db: Database = defaultDb) {
  return {
    admins: createAdminsRepository(db),
    areas: createAreasRepository(db),
    audit: createAuditRepository(db),
    commands: createCommandsRepository(db),
    maintenance: createMaintenanceRepository(db),
    otp: createOtpRepository(db),
    payments: createPaymentsRepository(db),
    plans: createPlansRepository(db),
    rides: createRidesRepository(db),
    subscriptions: createSubscriptionsRepository(db),
    telegramNonces: createTelegramNoncesRepository(db),
    users: createUsersRepository(db),
    vehicles: createVehiclesRepository(db),
    zones: createZonesRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;

export const repositories: Repositories = createRepositories();

export type { AdminsRepository, AuditRepository } from './admins.js';
export type { CommandsRepository } from './commands.js';
export type { MaintenanceRepository } from './maintenance.js';
export type { OtpRepository } from './otp.js';
export type { PaymentsRepository } from './payments.js';
export type { PlansRepository } from './plans.js';
export type { RideWithContext, RidesRepository } from './rides.js';
export type { SubscriptionsRepository } from './subscriptions.js';
export type { TelegramNoncesRepository } from './telegram-nonces.js';
export type { UsersRepository } from './users.js';
export type { VehiclesRepository } from './vehicles.js';
export type { AreasRepository, ZonesRepository } from './zones.js';
