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
import { colors, radius, shadows, spacing, typography } from '@/lib/theme';

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

/** Floating circular icon button — map controls, close/torch chrome. */
export function IconButton({
  name,
  onPress,
  color = colors.text,
  background = colors.surface,
  size = 44,
  accessibilityLabel,
  style,
  testID,
}: {
  name: IconName;
  onPress: () => void;
  color?: string;
  background?: string;
  size?: number;
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
          opacity: pressed ? 0.85 : 1,
        },
        shadows.md,
        style,
      ]}
    >
      <Icon name={name} size={size * 0.45} color={color} />
    </Pressable>
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
        variant === 'primary' && { backgroundColor: pressed ? colors.primaryPressed : colors.primary },
        variant === 'secondary' && [styles.buttonSecondary, pressed && { backgroundColor: colors.surfaceMuted }],
        variant === 'danger' && { backgroundColor: pressed ? '#D91E28' : colors.danger },
        variant === 'ghost' && { backgroundColor: pressed ? colors.surfaceMuted : 'transparent' },
        inactive && styles.buttonDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' || variant === 'ghost' ? colors.text : colors.textInverse} />
      ) : (
        <Text
          style={[
            styles.buttonLabel,
            (variant === 'secondary' || variant === 'ghost') && { color: colors.text },
          ]}
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
    <View style={[styles.pill, { backgroundColor: faint ?? `${colour}1A` }]}>
      <View style={[styles.pillDot, { backgroundColor: colour }]} />
      <Text style={[styles.pillLabel, { color: colour }]}>{label}</Text>
    </View>
  );
}

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
      style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: colors.surfaceMuted }]}
    >
      <Icon name={icon} size={20} color={colors.textSecondary} />
      <Text style={styles.menuLabel}>{label}</Text>
      <Icon name="chevronRight" size={14} color={colors.textTertiary} />
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
  button: {
    minHeight: 56,
    borderRadius: radius.m,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.m,
  },
  buttonSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: colors.textInverse,
  } as TextStyle,
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    padding: spacing.l,
    ...shadows.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.s,
  },
  rowLabel: { ...typography.body, color: colors.textSecondary } as TextStyle,
  rowValue: { ...typography.body, color: colors.text, fontWeight: '600' } as TextStyle,
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: spacing.m,
    paddingVertical: 5,
    borderRadius: radius.full,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillLabel: { ...typography.label } as TextStyle,
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.s + 2,
    paddingVertical: 5,
    borderRadius: radius.s,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.1,
    fontVariant: ['tabular-nums'],
  } as TextStyle,
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m + 2,
    borderRadius: radius.m,
  },
  menuLabel: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2, color: colors.text, flex: 1 },
  batteryTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  batteryFill: { height: '100%', borderRadius: 4 },
  skeleton: {
    backgroundColor: colors.skeleton,
    borderRadius: radius.s,
  },
});
