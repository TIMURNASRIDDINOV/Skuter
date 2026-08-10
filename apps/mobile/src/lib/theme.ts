import type { VehicleStatus, ZoneKind } from '@scoot/shared';
import type { TextStyle } from 'react-native';

/**
 * One definition of every colour and spacing step. Status and zone colours
 * mirror apps/admin/src/components/status.tsx so a colour never means two
 * different things across the rider app and the back office.
 */
export const colors = {
  background: '#F7F8FA',
  surface: '#FFFFFF',
  /** A card sitting on `surface` — the tariff tiles, the vehicle header. */
  surfaceElevated: '#F2F4F7',
  surfaceMuted: '#EEF0F3',
  border: '#ECEEF1',
  text: '#0B0F14',
  textSecondary: '#6E7781',
  /** Third rank: units next to a number, footnotes under a CTA. */
  textTertiary: '#9AA2AC',
  textInverse: '#FFFFFF',
  primary: '#10B981',
  primaryPressed: '#0DA271',
  primaryFaint: '#E7F8F1',
  /** Deep brand ink — the pressed state of dark chrome, the ride banner. */
  ink: '#0B1F1A',
  danger: '#F5222D',
  dangerFaint: '#FDECEC',
  warning: '#FAAD14',
  warningFaint: '#FEF6E6',
  info: '#1677FF',
  overlay: 'rgba(11, 15, 20, 0.5)',
  skeleton: '#E7E9EE',
} as const;

/**
 * Controls floating over a dark surface — the camera viewfinder on the scan
 * screen, and any full-bleed imagery that follows it.
 *
 * Not the map: over the pale Liberty basemap these read as holes punched in the
 * tiles, and the floating row on the map screen is white circles with
 * `shadows.lg` instead. Keep the two apart — a control's background is chosen
 * by what is behind it, not by whether it floats.
 */
export const chrome = {
  surface: 'rgba(11, 15, 20, 0.72)',
  surfacePressed: 'rgba(11, 15, 20, 0.86)',
  /** Chrome that sits on top of a sheet rather than the map. */
  surfaceLight: 'rgba(255, 255, 255, 0.92)',
  text: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.72)',
  border: 'rgba(255, 255, 255, 0.16)',
} as const;

export const VEHICLE_STATUS_COLOUR: Record<VehicleStatus, string> = {
  available: '#52C41A',
  in_use: '#1677FF',
  reserved: '#722ED1',
  low_battery: '#FAAD14',
  offline: '#8C8C8C',
  maintenance: '#F5222D',
};

/**
 * `slow` is amber-orange rather than the warning yellow `low_battery` already
 * owns — on the map the two are visible at once, and a rider must never have
 * to work out whether an amber shape is a zone or a scooter.
 */
export const ZONE_KIND_COLOUR: Record<ZoneKind, string> = {
  service: '#1677FF',
  parking: '#52C41A',
  forbidden: '#F5222D',
  slow: '#FA8C16',
};

export const spacing = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  s: 10,
  m: 14,
  l: 18,
  xl: 28,
  full: 999,
} as const;

export const typography = {
  /** Hero numbers — live ride cost, receipt total. */
  display: { fontSize: 40, fontWeight: '800', letterSpacing: -1 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.6 },
  heading: { fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '600' },
  caption: { fontSize: 12, fontWeight: '500' },
  mono: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
} as const;

/**
 * Figures that change in place — costs, counts, countdowns, battery.
 *
 * Spread onto any text style that renders a number the rider watches. Without
 * tabular figures a ticking value shifts width digit by digit, which reads as
 * the layout twitching rather than the number counting.
 */
// Annotated rather than `as const`: the const assertion makes `fontVariant` a
// readonly tuple, which fails to match `TextStyle` and quietly widens every
// entry of any StyleSheet it is spread into to `ViewStyle | TextStyle | ImageStyle`.
export const numeric: TextStyle = { fontVariant: ['tabular-nums'] };

/**
 * Elevation, Uber-style: soft, tight, never muddy. `sm` for resting cards,
 * `md` for floating controls over the map, `lg` for sheets and FABs.
 */
export const shadows = {
  sm: {
    shadowColor: '#0B0F14',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: '#0B0F14',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  lg: {
    shadowColor: '#0B0F14',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
} as const;

export function batteryColour(pct: number): string {
  if (pct <= 20) return colors.danger;
  if (pct <= 40) return colors.warning;
  return VEHICLE_STATUS_COLOUR.available;
}
