import type { Vehicle } from '@scoot/shared';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui';
import { formatCountdown } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { colors, numeric, radius, shadows, spacing, typography } from '@/lib/theme';

/**
 * The live hold, pinned over the map.
 *
 * Ticks locally once a second rather than waiting on the 5 s poll: a countdown
 * that jumps in five-second steps reads as broken, and the number it shows is
 * derived from a server timestamp, so drifting between polls is impossible.
 * `onExpire` fires once when it reaches zero so the screen can refetch and
 * drop the banner without waiting for the next poll.
 */
export function ReservationBanner({
  vehicle,
  until,
  onPress,
  onCancel,
  onExpire,
}: {
  vehicle: Vehicle;
  until: string;
  onPress: () => void;
  onCancel: () => void;
  onExpire: () => void;
}) {
  const { t } = useI18n();
  const [secondsLeft, setSecondsLeft] = useState(() => remaining(until));

  useEffect(() => {
    setSecondsLeft(remaining(until));
    const timer = setInterval(() => {
      const next = remaining(until);
      setSecondsLeft(next);
      if (next <= 0) {
        clearInterval(timer);
        onExpire();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [until, onExpire]);

  if (secondsLeft <= 0) return null;

  return (
    <Pressable style={styles.banner} onPress={onPress} testID="reservation-banner">
      <View style={styles.icon}>
        <Icon name="lock" size={16} color={colors.primary} />
      </View>

      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={1}>
          {vehicle.qrCode}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {t.reservationLeft} {formatCountdown(secondsLeft)}
        </Text>
      </View>

      {/* Its own hit target inside the banner: tapping the banner walks you to
          the scooter, which is the opposite of giving it up. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.cancelReservation}
        onPress={onCancel}
        hitSlop={10}
        style={styles.cancel}
        testID="cancel-reservation"
      >
        <Icon name="close" size={14} color={colors.textInverse} />
      </Pressable>
    </Pressable>
  );
}

function remaining(until: string): number {
  return Math.max(0, (new Date(until).getTime() - Date.now()) / 1000);
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.ink,
    borderRadius: radius.full,
    paddingLeft: spacing.s,
    paddingRight: spacing.s,
    paddingVertical: spacing.s,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    ...shadows.lg,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 1 },
  title: { ...typography.label, color: colors.textInverse, ...numeric },
  subtitle: { ...typography.caption, color: 'rgba(255,255,255,0.72)', ...numeric },
  cancel: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
