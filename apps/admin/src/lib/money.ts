import { formatSom, formatSomAmount, tiyinToSom } from '@ozothunder/shared';

/** Re-exported so pages import money helpers from one place. */
export { formatSom, formatSomAmount };

/** Numeric so'm for chart axes, which cannot take a formatted string. */
export function tiyinToSomNumber(tiyin: number): number {
  return Math.round(tiyinToSom(tiyin));
}
