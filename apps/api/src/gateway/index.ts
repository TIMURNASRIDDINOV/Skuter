import { env } from '../env.js';
import { repositories } from '../repositories/index.js';
import { runtimeStorage } from '../runtime.js';
import { DurableGateway } from './durable.js';
import { IotGateway } from './iot.js';
import { SimulatedGateway } from './simulated.js';
import type { ManagedVehicleGateway, SimulationControl, VehicleGateway } from './types.js';

/**
 * The gateway factory — **the only module in the codebase that knows which
 * implementation is active.** Everything else takes a `VehicleGateway` and
 * programs against the interface.
 *
 * Selected by `VEHICLE_GATEWAY` (`simulated` | `iot` | `durable`). The
 * `durable` case never constructs anything here: worker.ts builds a
 * DurableGateway per request and carries it in the runtime context.
 */

let instance: ManagedVehicleGateway | null = null;

function create(): ManagedVehicleGateway {
  if (env.VEHICLE_GATEWAY === 'durable') {
    throw new Error('durable gateway must come from the runtime context — is worker.ts the entry?');
  }
  return env.VEHICLE_GATEWAY === 'iot' ? new IotGateway() : new SimulatedGateway(repositories);
}

function resolve(): ManagedVehicleGateway {
  const contextual = runtimeStorage.getStore()?.gateway;
  if (contextual !== undefined) return contextual;
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
  return active instanceof SimulatedGateway || active instanceof DurableGateway ? active : null;
}

export type { SimulationControl, SimulationSnapshot, Unsubscribe, VehicleGateway } from './types.js';
