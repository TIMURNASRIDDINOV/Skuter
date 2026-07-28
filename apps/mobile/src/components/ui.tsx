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
import { colors, radius, spacing, typography } from '@/lib/theme';

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
    minHeight: 52,
    borderRadius: radius.l,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.m,
  },
  buttonSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { ...typography.heading, color: colors.textInverse } as TextStyle,
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    padding: spacing.l,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
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
