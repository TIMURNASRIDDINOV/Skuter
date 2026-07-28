import type { VehicleStatus, ZoneKind } from '@scoot/shared';

/**
 * One definition of every colour and spacing step. Status and zone colours
 * mirror apps/admin/src/components/status.tsx so a colour never means two
 * different things across the rider app and the back office.
 */
export const colors = {
  background: '#F6F7F9',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF0F3',
  border: '#E4E7EB',
  text: '#16191D',
  textSecondary: '#6B7280',
  textInverse: '#FFFFFF',
  primary: '#10B981',
  primaryPressed: '#0DA271',
  primaryFaint: '#E7F8F1',
  danger: '#F5222D',
  dangerFaint: '#FDECEC',
  warning: '#FAAD14',
  warningFaint: '#FEF6E6',
  info: '#1677FF',
  overlay: 'rgba(15, 20, 25, 0.45)',
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
  s: 8,
  m: 12,
  l: 16,
  xl: 24,
  full: 999,
} as const;

export const typography = {
  title: { fontSize: 24, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '500' },
  caption: { fontSize: 12, fontWeight: '400' },
  mono: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
} as const;

export function batteryColour(pct: number): string {
  if (pct <= 20) return colors.danger;
  if (pct <= 40) return colors.warning;
  return VEHICLE_STATUS_COLOUR.available;
}
