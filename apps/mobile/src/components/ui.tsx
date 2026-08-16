import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import {
  caps,
  colors,
  outline,
  outlineHair,
  radius,
  shadows,
  spacing,
  typography,
} from '@/lib/theme';

/**
 * The app's icon vocabulary — native SF Symbols on iOS, Material Symbols on
 * Android (both ship with expo-symbols; no icon font of our own). Screens
 * never name platform symbols directly: they pick from this curated map so
 * the same concept always renders the same glyph.
 */
const ICONS = {
  map: { ios: 'map.fill', android: 'map' },
  ticket: { ios: 'ticket.fill', android: 'confirmation_number' },
  person: { ios: 'person.fill', android: 'person' },
  scan: { ios: 'qrcode.viewfinder', android: 'qr_code_scanner' },
  scooter: { ios: 'scooter', android: 'electric_scooter' },
  locate: { ios: 'location.fill', android: 'my_location' },
  close: { ios: 'xmark', android: 'close' },
  back: { ios: 'chevron.left', android: 'arrow_back' },
  chevronRight: { ios: 'chevron.right', android: 'chevron_right' },
  flash: { ios: 'bolt.fill', android: 'flash_on' },
  bolt: { ios: 'bolt.fill', android: 'bolt' },
  bell: { ios: 'bell.fill', android: 'notifications' },
  check: { ios: 'checkmark.circle.fill', android: 'check_circle' },
  alert: { ios: 'exclamationmark.triangle.fill', android: 'warning' },
  send: { ios: 'paperplane.fill', android: 'send' },
  wallet: { ios: 'creditcard.fill', android: 'account_balance_wallet' },
  clock: { ios: 'clock.fill', android: 'schedule' },
  walk: { ios: 'figure.walk', android: 'directions_walk' },
  keypad: { ios: 'keyboard', android: 'keyboard' },
  language: { ios: 'globe', android: 'language' },
  logout: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout' },
  history: { ios: 'clock.arrow.circlepath', android: 'history' },
  parking: { ios: 'p.circle.fill', android: 'local_parking' },
  info: { ios: 'info.circle.fill', android: 'info' },
  speed: { ios: 'speedometer', android: 'speed' },
  block: { ios: 'nosign', android: 'block' },
  layers: { ios: 'square.3.layers.3d', android: 'layers' },
  lock: { ios: 'lock.fill', android: 'lock' },
  timer: { ios: 'timer', android: 'timer' },
  menu: { ios: 'line.3.horizontal', android: 'menu' },
  route: { ios: 'arrow.triangle.turn.up.right.diamond.fill', android: 'route' },
} as const satisfies Record<string, SymbolViewProps['name']>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 22,
  color = colors.text,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return <SymbolView name={ICONS[name]} size={size} tintColor={color} style={style} />;
}

/**
 * Floating circular icon button — map controls, close/torch chrome.
 *
 * Outlined by default, because that is what makes a white circle read as an
 * object over the pale basemap rather than a smudge on it. `bare` drops both
 * the outline and the shadow for the ones that sit *inside* an already-outlined
 * surface, where a second ink ring would be a box in a box.
 */
export function IconButton({
  name,
  onPress,
  color = colors.text,
  background = colors.surface,
  size = 44,
  bare = false,
  accessibilityLabel,
  style,
  testID,
}: {
  name: IconName;
  onPress: () => void;
  color?: string;
  background?: string;
  size?: number;
  bare?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: background,
          alignItems: 'center',
          justifyContent: 'center',
        },
        !bare && outline,
        !bare && shadows.md,
        // Pressing sinks the button onto its own shadow instead of fading it:
        // an outlined control at 85% opacity looks broken, not pressed.
        pressed && (bare ? { opacity: 0.6 } : PRESS_SINK),
        style,
      ]}
    >
      <Icon name={name} size={size * 0.45} color={color} />
    </Pressable>
  );
}

/**
 * The pressed state for anything wearing a hard offset shadow: drop the offset
 * and translate down by the same amount, so the surface visibly meets the page.
 */
const PRESS_SINK = {
  transform: [{ translateY: 2 }],
  shadowOffset: { width: 0, height: 1 },
  elevation: 1,
} as const;

/**
 * Back arrow, centred title, and a spacer that balances the arrow so the title
 * sits on the screen's centre line rather than the centre of what is left.
 *
 * Every screen pushed on top of the map wears this. `rules.tsx` keeps its own —
 * it carries a subtitle under the title, which this deliberately does not.
 */
export function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.screenHeader}>
      <IconButton name="back" onPress={onBack} size={40} />
      <Text style={styles.screenHeaderTitle}>{title}</Text>
      <View style={styles.screenHeaderSpacer} />
    </View>
  );
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  testID,
}: ButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        // Volt, sage and red all take ink labels; only `ghost` is unoutlined,
        // because a ghost that keeps the outline is just a secondary button.
        variant === 'primary' && { backgroundColor: pressed ? colors.primaryPressed : colors.primary },
        variant === 'secondary' && { backgroundColor: pressed ? colors.surfaceMuted : colors.surface },
        variant === 'danger' && { backgroundColor: pressed ? '#E62A40' : colors.danger },
        variant !== 'ghost' && outline,
        variant !== 'ghost' && shadows.md,
        variant === 'ghost' && { backgroundColor: pressed ? colors.surfaceMuted : 'transparent' },
        pressed && variant !== 'ghost' && PRESS_SINK,
        inactive && styles.buttonDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'danger' ? colors.textInverse : colors.text} />
      ) : (
        <Text
          style={[styles.buttonLabel, variant === 'danger' && { color: colors.textInverse }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: string;
  valueStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, valueStyle]}>{value}</Text>
    </View>
  );
}

export function Pill({
  label,
  colour,
  faint,
}: {
  label: string;
  colour: string;
  faint?: string;
}) {
  return (
    <View style={[styles.pill, { backgroundColor: faint ?? `${colour}2E` }]}>
      <View style={[styles.pillDot, { backgroundColor: colour }]} />
      <Text style={styles.pillLabel}>{label}</Text>
    </View>
  );
}

/**
 * Charge as a bar. Outlined and squared off rather than a soft capsule — the
 * outline is what lets a 20 % fill still read as "a bar that is nearly empty"
 * instead of a stray coloured dash.
 */
export function BatteryBar({ pct, colour }: { pct: number; colour: string }) {
  return (
    <View style={styles.batteryTrack}>
      <View
        style={[styles.batteryFill, { width: `${Math.max(2, Math.min(100, pct))}%`, backgroundColor: colour }]}
      />
    </View>
  );
}

/**
 * A small fact with an icon — battery, walk time, remaining range.
 *
 * The reference app stacks two or three of these under a scooter's number, and
 * they carry most of what a rider decides on. Tinted background rather than a
 * border: at this size a 1px outline reads as a text field.
 */
export function Chip({
  icon,
  label,
  colour = colors.text,
  background = colors.surfaceElevated,
}: {
  icon?: IconName;
  label: string;
  colour?: string;
  background?: string;
}) {
  return (
    <View style={[styles.chip, { backgroundColor: background }]}>
      {icon !== undefined && <Icon name={icon} size={13} color={colour} />}
      <Text style={[styles.chipLabel, { color: colour }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * A heavy, wide-tracked, uppercase caption — the label above a value, the
 * section head inside a sheet. The style's smallest recurring gesture.
 */
export function Caps({
  children,
  color = colors.textSecondary,
  style,
}: {
  children: ReactNode;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[styles.caps, { color }, style]}>{children}</Text>;
}

/**
 * A tappable row that leads somewhere — the menu under the map sheet.
 * Icon, label, chevron; the whole row is the target, not just the text.
 */
export function MenuRow({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        pressed && { backgroundColor: colors.surfaceMuted },
        pressed && PRESS_SINK,
      ]}
    >
      <View style={styles.menuIcon}>
        <Icon name={icon} size={18} color={colors.text} />
      </View>
      <Text style={styles.menuLabel}>{label}</Text>
      <Icon name="chevronRight" size={14} color={colors.text} />
    </Pressable>
  );
}

/** Pulsing placeholder block — the loading state everywhere. */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const opacity = useSharedValue(0.6);
  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(withTiming(1, { duration: 600 }), withTiming(0.6, { duration: 600 })),
      -1,
    );
  }, [opacity]);
  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.skeleton, style, animatedStyle]} />;
}

const styles = StyleSheet.create({
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: spacing.s,
  },
  screenHeaderSpacer: { width: 40, height: 40 },
  screenHeaderTitle: {
    ...typography.heading,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
  } as TextStyle,
  button: {
    minHeight: 56,
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonLabel: {
    ...caps,
    fontSize: 15,
    // Overrides `caps`' tracking: at 15sp across a full-width button, 0.8 puts
    // «ЗАБРОНИРОВАТЬ НА 15 МИН» over the edge on a 375pt screen.
    letterSpacing: 0.4,
    color: colors.onPrimary,
  } as TextStyle,
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    padding: spacing.l,
    ...outline,
    ...shadows.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.s,
  },
  rowLabel: { ...typography.body, color: colors.textSecondary } as TextStyle,
  rowValue: { ...typography.body, color: colors.text, fontWeight: '800' } as TextStyle,
  caps: { fontSize: 12, ...caps } as TextStyle,
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: spacing.m,
    paddingVertical: 5,
    borderRadius: radius.full,
    ...outlineHair,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4, ...outlineHair },
  // Ink on a tinted ground rather than the tint's own colour as text: at 13sp
  // the status hues are what the dot is for, and the word has to stay readable.
  pillLabel: { fontSize: 12, ...caps, color: colors.text } as TextStyle,
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.s + 2,
    paddingVertical: 5,
    borderRadius: radius.s,
    ...outlineHair,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.1,
    fontVariant: ['tabular-nums'],
  } as TextStyle,
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.m,
    borderRadius: radius.m,
    backgroundColor: colors.surface,
    ...outline,
    ...shadows.sm,
  },
  menuIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceBrand,
    alignItems: 'center',
    justifyContent: 'center',
    ...outlineHair,
  },
  menuLabel: { fontSize: 16, fontWeight: '800', letterSpacing: -0.2, color: colors.text, flex: 1 },
  batteryTrack: {
    height: 10,
    borderRadius: radius.s,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    ...outlineHair,
  },
  batteryFill: { height: '100%' },
  skeleton: {
    backgroundColor: colors.skeleton,
    borderRadius: radius.s,
    ...outlineHair,
  },
});
