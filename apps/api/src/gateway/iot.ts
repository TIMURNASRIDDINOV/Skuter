import type { CommandResult, Telemetry } from '@scoot/shared';
import { NotImplementedError } from '../lib/errors.js';
import type { ManagedVehicleGateway, Unsubscribe } from './types.js';

/**
 * PHASE 2 — real hardware. Not implemented.
 *
 * When the client buys a fleet, this is where it plugs in. The scooter
 * controllers (Omni/Jimi-style IoT boxes on a cellular SIM) speak MQTT to a
 * broker; this class becomes an MQTT client that:
 *
 *   - publishes commands to `scoot/{imei}/command` and resolves the returned
 *     promise when the controller acknowledges on `scoot/{imei}/ack`, keyed by
 *     the command id already persisted in the `commands` table;
 *   - subscribes to `scoot/+/telemetry` and forwards each frame to
 *     `subscribeTelemetry` listeners in the same `Telemetry` shape the
 *     simulator emits.
 *
 * Because the whole application is written against `VehicleGateway`, nothing
 * outside this directory changes when that happens — flip `VEHICLE_GATEWAY=iot`
 * and the simulated fleet is replaced by real scooters. That is the entire
 * point of the seam.
 */
export class IotGateway implements ManagedVehicleGateway {
  async start(): Promise<void> {
    throw new NotImplementedError(
      'IotGateway is a phase-2 stub: connecting to real scooter controllers over MQTT is not implemented. Set VEHICLE_GATEWAY=simulated.',
    );
  }

  async stop(): Promise<void> {
    // Nothing to tear down — start() never succeeds.
    await Promise.resolve();
  }

  async unlock(_vehicleId: string): Promise<CommandResult> {
    throw new NotImplementedError('IotGateway.unlock is not implemented (phase 2, MQTT)');
  }

  async lock(_vehicleId: string): Promise<CommandResult> {
    throw new NotImplementedError('IotGateway.lock is not implemented (phase 2, MQTT)');
  }

  async beep(_vehicleId: string): Promise<CommandResult> {
    throw new NotImplementedError('IotGateway.beep is not implemented (phase 2, MQTT)');
  }

  subscribeTelemetry(_cb: (t: Telemetry) => void): Unsubscribe {
    throw new NotImplementedError(
      'IotGateway.subscribeTelemetry is not implemented (phase 2, MQTT)',
    );
  }
}
