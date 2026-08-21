import type { VehicleStatus, ZoneKind } from '@ozothunder/shared';
import type { TextStyle, ViewStyle } from 'react-native';

/**
 * One definition of every colour, border and spacing step.
 *
 * The rider app is **bold**: a cream canvas, a hard ink outline on every
 * surface, volt green for the one thing you are meant to press, and heavy
 * uppercase micro-labels. Nothing here is a soft grey card floating on white —
 * a surface is defined by its outline, and elevation is a hard offset shadow
 * rather than a diffuse one.
 *
 * Status and zone colours still mirror apps/admin/src/components/status.tsx so
 * a colour never means two different things across the rider app and the back
 * office. Those are the one part of this file the re-skin does not touch.
 */
export const colors = {
  /** The cream canvas everything sits on. */
  background: '#F7F9F2',
  surface: '#FFFFFF',
  /** A panel sitting on `surface` — the tariff tiles, the vehicle hero. */
  surfaceElevated: '#F0F3EA',
  surfaceMuted: '#E1E3DA',
  /** Sage, for the surfaces that want to read as "on brand" without shouting. */
  surfaceBrand: '#D7E8CD',
  /**
   * Ink, and the same ink as `text` — in this style an outline is not a hairline
   * separator, it is the edge of the object. Pair it with `border.width`.
   */
  border: '#1A1C18',
  /** Divider inside a bordered surface, where a full ink rule would be too loud. */
  borderSoft: '#CBD0C4',
  text: '#1A1C18',
  textSecondary: '#424940',
  /** Third rank: units next to a number, footnotes under a CTA. */
  textTertiary: '#6E786B',
  textInverse: '#FFFFFF',
  /**
   * Volt. A **fill**, never a foreground: at 15sp on white it is unreadable.
   * Text and icons that want to look "primary" on a light surface use
   * `primaryInk`; text on a volt fill uses `onPrimary`.
   */
  primary: '#BCF246',
  primaryPressed: '#A6DC32',
  /** Volt dark enough to read as text or an icon on cream or white. */
  primaryInk: '#5E8511',
  /** What goes on top of a volt fill — ink, not white. */
  onPrimary: '#1A1C18',
  primaryFaint: '#EAF7CE',
  /** Deep brand ink — dark chrome, the ride banner. */
  ink: '#1A1C18',
  danger: '#FF334B',
  dangerFaint: '#FFE0E4',
  warning: '#FFB800',
  warningFaint: '#FFF1CC',
  info: '#00C5FF',
  overlay: 'rgba(26, 28, 24, 0.55)',
  skeleton: '#E1E3DA',
} as const;

/**
 * Controls floating over a dark surface — the camera viewfinder on the scan
 * screen, and any full-bleed imagery that follows it.
 *
 * Not the map: over the pale Liberty basemap these read as holes punched in the
 * tiles, and the floating row on the map screen is white circles with an ink
 * outline instead. Keep the two apart — a control's background is chosen by
 * what is behind it, not by whether it floats.
 */
export const chrome = {
  surface: 'rgba(26, 28, 24, 0.74)',
  surfacePressed: 'rgba(26, 28, 24, 0.88)',
  /** Chrome that sits on top of a sheet rather than the map. */
  surfaceLight: 'rgba(255, 255, 255, 0.94)',
  text: '#FFFFFF',
  textSecondary: 'rgba(255, 255, 255, 0.72)',
  border: 'rgba(255, 255, 255, 0.24)',
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

/**
 * Outline widths. `hair` is for rules *inside* an already-bordered surface;
 * everything that is an object in its own right gets `base`, and the chrome a
 * rider taps while walking gets `thick`.
 */
export const border = {
  hair: 1,
  base: 1.5,
  base2: 2,
  thick: 2.5,
} as const;

/**
 * The outline every surface wears. Spread it rather than writing the pair by
 * hand, so a change of weight is one edit.
 */
export const outline: ViewStyle = { borderWidth: border.base2, borderColor: colors.border };
export const outlineHair: ViewStyle = { borderWidth: border.hair, borderColor: colors.border };

export const radius = {
  s: 8,
  m: 14,
  l: 20,
  xl: 28,
  full: 999,
} as const;

export const typography = {
  /** Hero numbers — live ride cost, receipt total. */
  display: { fontSize: 42, fontWeight: '900', letterSpacing: -1.5 },
  title: { fontSize: 28, fontWeight: '900', letterSpacing: -0.8 },
  heading: { fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
  body: { fontSize: 15, fontWeight: '500' },
  label: { fontSize: 13, fontWeight: '700' },
  caption: { fontSize: 12, fontWeight: '500' },
  mono: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
} as const;

/**
 * The style's signature: a short, heavy, wide-tracked, uppercase micro-label.
 *
 * Spread onto a label that names a value rather than being one — ЗАРЯД above
 * 84%, ТАРИФ above the picker, the text inside a button. Russian and Uzbek
 * both capitalise cleanly at this size; what they do not survive is a long
 * *sentence* in caps, so this belongs on labels, never on body copy.
 */
export const caps: TextStyle = {
  textTransform: 'uppercase',
  fontWeight: '900',
  letterSpacing: 0.8,
};

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
 * Elevation as a hard offset, not a blur.
 *
 * A diffuse shadow under an ink-outlined surface reads as smudge: the outline
 * has already drawn the edge, so the shadow's only job is to say how far off
 * the page the thing sits. `sm` for resting cards, `md` for floating controls
 * over the map, `lg` for sheets and the scan control.
 *
 * Android has no offset-shadow primitive — `elevation` renders its own diffuse
 * one — so the outline is what carries the style there, and these numbers stay
 * low enough that the two never fight.
 */
export const shadows = {
  sm: {
    shadowColor: colors.border,
    shadowOpacity: 1,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  md: {
    shadowColor: colors.border,
    shadowOpacity: 1,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  lg: {
    shadowColor: colors.border,
    shadowOpacity: 1,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  /**
   * Sheets only. A sheet's bottom edge is off-screen, so an offset downward
   * shadow does nothing for it — this one lifts upward and keeps a little blur,
   * which is the one place in the app where blur is the right answer.
   */
  sheet: {
    shadowColor: colors.border,
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -6 },
    elevation: 16,
  },
} as const;

/**
 * Charge, as a colour.
 *
 * Darker than the matching `VEHICLE_STATUS_COLOUR` entries on purpose: this one
 * is read as *text* — «84 %» beside the battery bar — and the pin colours are
 * tuned for a filled shape on the map, where a light green is legible and at
 * 15sp on white it is not. The bands are the same; only the ink is heavier.
 */
export function batteryColour(pct: number): string {
  if (pct <= 20) return '#D91130';
  if (pct <= 40) return '#A96D00';
  return '#4E8A12';
}
