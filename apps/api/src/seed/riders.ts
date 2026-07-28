/**
 * Accounts the fleet simulator rides under.
 *
 * A rider may only have one ride in flight (enforced by a partial unique
 * index), so simulated rides need their own accounts. Without this the
 * simulator occupies the demo accounts, and whoever logs in for the demo finds
 * a phantom ride already in progress — which breaks demo step 2.
 *
 * Deliberately its own module: `seed/index.ts` runs on import, so importing a
 * constant from there would trigger a reseed.
 */
export const SIMULATOR_RIDER_PREFIX = '+99899000';
export const SIMULATOR_RIDER_COUNT = 6;

export function simulatorRiderPhone(index: number): string {
  return `${SIMULATOR_RIDER_PREFIX}${(index + 1).toString().padStart(4, '0')}`;
}

export function isSimulatorRider(phone: string): boolean {
  return phone.startsWith(SIMULATOR_RIDER_PREFIX);
}
