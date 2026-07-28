import { env } from '../env.js';
import { repositories } from '../repositories/index.js';
import { IotGateway } from './iot.js';
import { SimulatedGateway } from './simulated.js';
import type { ManagedVehicleGateway, SimulationControl, VehicleGateway } from './types.js';

/**
 * The gateway factory — **the only module in the codebase that knows which
 * implementation is active.** Everything else takes a `VehicleGateway` and
 * programs against the interface.
 *
 * Selected by `VEHICLE_GATEWAY` (`simulated` | `iot`).
 */

let instance: ManagedVehicleGateway | null = null;

function create(): ManagedVehicleGateway {
  return env.VEHICLE_GATEWAY === 'iot' ? new IotGateway() : new SimulatedGateway(repositories);
}

function resolve(): ManagedVehicleGateway {
  instance ??= create();
  return instance;
}

/** The active gateway, as the narrow interface callers are allowed to see. */
export function getVehicleGateway(): VehicleGateway {
  return resolve();
}

export async function startVehicleGateway(): Promise<void> {
  await resolve().start();
}

export async function stopVehicleGateway(): Promise<void> {
  if (instance === null) return;
  await instance.stop();
  instance = null;
}

/**
 * Demo controls, available only when the active gateway simulates its fleet.
 * Returns null for real hardware — you cannot "force a ride" on a scooter that
 * a person is holding. The /dev/simulate/* routes answer 501 in that case.
 */
export function getSimulationControl(): SimulationControl | null {
  const active = resolve();
  return active instanceof SimulatedGateway ? active : null;
}

export type { SimulationControl, SimulationSnapshot, Unsubscribe, VehicleGateway } from './types.js';
