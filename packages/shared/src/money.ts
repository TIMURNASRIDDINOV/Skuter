import { TIYIN_PER_SOM } from './constants.js';

/**
 * Money is integer **tiyin** everywhere in the system — never floats, never
 * so'm. 1 so'm = 100 tiyin. Conversion to so'm happens only at display time.
 */
export type Tiyin = number;

/** Non-breaking space, so "12 500 so'm" never wraps mid-number. */
const GROUP_SEPARATOR = '\u00A0';

export function somToTiyin(som: number): Tiyin {
  return Math.round(som * TIYIN_PER_SOM);
}

export function tiyinToSom(tiyin: Tiyin): number {
  return tiyin / TIYIN_PER_SOM;
}

/** Group digits in threes: 12500 -> "12 500". */
function groupDigits(value: number): string {
  const sign = value < 0 ? '-' : '';
  const digits = Math.abs(value).toFixed(0);
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += GROUP_SEPARATOR;
    out += digits[i];
  }
  return sign + out;
}

/**
 * Format tiyin for display: `formatSom(1_250_000)` -> `12 500 so'm`.
 *
 * The tiyin subunit is not in circulation, so amounts are rounded to whole
 * so'm for display. The underlying integer is never rounded.
 */
export function formatSom(tiyin: Tiyin): string {
  return `${groupDigits(Math.round(tiyinToSom(tiyin)))}${GROUP_SEPARATOR}so'm`;
}

/** Same as `formatSom` but without the currency suffix, for table cells. */
export function formatSomAmount(tiyin: Tiyin): string {
  return groupDigits(Math.round(tiyinToSom(tiyin)));
}
