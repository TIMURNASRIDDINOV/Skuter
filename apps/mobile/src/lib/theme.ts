import type { VehicleStatus, ZoneKind } from '@scoot/shared';

/**
 * One definition of every colour and spacing step. Status and zone colours
 * mirror apps/admin/src/components/status.tsx so a colour never means two
 * different things across the rider app and the back office.
 */
export const colors = {
  background: '#F7F8FA',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF0F3',
  border: '#ECEEF1',
  text: '#0B0F14',
  textSecondary: '#6E7781',
  textInverse: '#FFFFFF',
  primary: '#10B981',
  primaryPressed: '#0DA271',
  primaryFaint: '#E7F8F1',
  danger: '#F5222D',
  dangerFaint: '#FDECEC',
  warning: '#FAAD14',
  warningFaint: '#FEF6E6',
  info: '#1677FF',
  overlay: 'rgba(11, 15, 20, 0.5)',
  skeleton: '#E7E9EE',
} as const;

export const VEHICLE_STATUS_COLOUR: Record<VehicleStatus, string> = {
  available: '#52C41A',
  in_use: '#1677FF',
  reserved: '#722ED1',
  low_battery: '#FAAD14',
  offline: '#8C8C8C',
  maintenance: '#F5222D',
};

export const ZONE_KIND_COLOUR: Record<ZoneKind, string> = {
  service: '#1677FF',
  parking: '#52C41A',
  forbidden: '#F5222D',
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
  display: { fontSize: 34, fontWeight: '800', letterSpacing: -0.5 },
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  heading: { fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 15, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '600' },
  caption: { fontSize: 12, fontWeight: '500' },
  mono: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
} as const;

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
