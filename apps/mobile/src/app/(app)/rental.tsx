import { formatSom } from '@ozothunder/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useRental, useRentalBeep, useRentalLock } from '@/api/queries';
import { ApiRequestError } from '@/api/client';
import { ModeSwitch } from '@/components/ModeSwitch';
import { SlideToLock } from '@/components/SlideToLock';
import { ErrorState, ListSkeleton } from '@/components/states';
import { BatteryBar, Button, Icon } from '@/components/ui';
import {
  formatCountdownLong,
  formatDate,
  formatDistance,
  formatMinutes,
  formatTime,
} from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useRentalMode } from '@/lib/rental-mode';
import {
  batteryColour,
  caps,
  colors,
  numeric,
  outline,
  outlineHair,
  radius,
  shadows,
  spacing,
  typography,
} from '@/lib/theme';

/**
 * The app's second face: one scooter, rented, on or off.
 *
 * Every rental lands here — three hours bought in the app, or a fortnight
 * signed for at a desk. Everything the ordinary app is about is deliberately
 * absent: no map and no zone rules, because a rental puts responsibility for
 * where the scooter goes on the rider; no cost and no per-minute tariff,
 * because the window was paid for up front. What is left is the switch, how
 * long is left, and how much charge there is.
 *
 * A rental that ends — swept at expiry, or stopped by an operator — empties
 * this screen, and the effect below sends the rider back to the map. That is
 * the same mechanism for both doors: the window closes, or the office closes
 * it, and the app just follows.
 */
export default function RentalScreen() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { setMode } = useRentalMode();

  const rentalQuery = useRental();
  const lock = useRentalLock();
  const beep = useRentalBeep();

  const [notice, setNotice] = useState<string | null>(null);

  const rental = rentalQuery.data?.rental ?? null;
  const expiresAt = rental?.subscription.expiresAt ?? null;
  const secondsLeft = useSecondsLeft(expiresAt);

  const toMap = (): void => {
    setMode('map');
    router.replace('/');
  };

  // The rental ended while the rider was looking at it. Nothing here is true
  // any more, so leave rather than show a screen about a scooter they no
  // longer have.
  useEffect(() => {
    if (rentalQuery.data !== undefined && rentalQuery.data.rental === null) {
      setMode('map');
      router.replace('/');
    }
  }, [rentalQuery.data, setMode, router]);

  if (rentalQuery.isError && rentalQuery.data === undefined) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ErrorState onRetry={() => void rentalQuery.refetch()} style={styles.grow} />
      </SafeAreaView>
    );
  }

  if (rental === null) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <ModeSwitch target="map" onPress={toMap} />
        </View>
        <ListSkeleton rows={3} />
      </SafeAreaView>
    );
  }

  const unlocked = rental.subscription.unlockedAt !== null;
  const battery = rental.vehicle.batteryPct;

  const toggle = (next: boolean): void => {
    setNotice(null);
    lock.mutate(
      { subscriptionId: rental.subscription.id, unlocked: next },
      {
        onError: (cause: unknown) => {
          setNotice(
            cause instanceof ApiRequestError ? cause.message : t.rentalCommandFailed,
          );
        },
      },
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* The switch sits exactly where the brand mark does on the map, so
          crossing between the app's two faces is always the same corner. */}
      <View style={styles.header}>
        <ModeSwitch target="map" onPress={toMap} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroGlow}>
            <Icon name="scooter" size={72} color={colors.onPrimary} />
          </View>
          <Text style={styles.heroCode}>{rental.vehicle.qrCode}</Text>
          <Text style={styles.heroModel} numberOfLines={1}>
            {rental.vehicle.model}
          </Text>
          <View style={[styles.state, unlocked && styles.stateOn]}>
            <Icon
              name={unlocked ? 'bolt' : 'lock'}
              size={13}
              color={unlocked ? colors.onPrimary : colors.textSecondary}
            />
            <Text style={[styles.stateLabel, unlocked && styles.stateLabelOn]}>
              {unlocked ? t.rentalStateOn : t.rentalStateOff}
            </Text>
          </View>
        </View>

        <SlideToLock unlocked={unlocked} pending={lock.isPending} onChange={toggle} />

        {notice !== null && (
          <Animated.View entering={FadeIn} style={styles.notice}>
            <Icon name="alert" size={16} color={colors.danger} />
            <Text style={styles.noticeText}>{notice}</Text>
          </Animated.View>
        )}

        {/* How long is left, then when that is.
            The counter is the headline because most rentals are now hours
            long, and «до 14:32» tells a rider holding a three-hour rental
            nothing they can act on. Past a day it switches to «6 дн 4 ч»:
            `147:12:08` is technically the same number and reads as noise. */}
        <View style={styles.until}>
          <Text style={styles.untilLabel}>{t.rentalEndsIn}</Text>
          <Text style={styles.untilCountdown}>
            {secondsLeft >= DAY_S
              ? formatMinutes(secondsLeft / 60, lang)
              : formatCountdownLong(secondsLeft)}
          </Text>
          <Text style={styles.untilTime}>
            {t.rentalEndsAt} {formatDate(rental.subscription.expiresAt, lang)},{' '}
            {formatTime(rental.subscription.expiresAt, lang)}
          </Text>
        </View>

        <View style={styles.tiles}>
          <View style={styles.tile}>
            <Text style={styles.tileLabel}>{t.battery}</Text>
            <Text style={[styles.tileValue, { color: batteryColour(battery) }]}>
              {battery}
              <Text style={styles.tileUnit}> %</Text>
            </Text>
            <BatteryBar pct={battery} colour={batteryColour(battery)} />
          </View>

          <View style={styles.tile}>
            <Text style={styles.tileLabel}>{t.range}</Text>
            <Text style={styles.tileValue}>{formatDistance(rental.vehicle.rangeM, lang)}</Text>
          </View>
        </View>

        <Button
          label={beep.isSuccess ? t.beepSent : t.rentalFindIt}
          variant="secondary"
          loading={beep.isPending}
          onPress={() => {
            beep.mutate(rental.subscription.id);
          }}
        />

        <View style={styles.footer}>
          <Text style={styles.footerText}>{t.rentalPlanNote}</Text>
          <Text style={styles.footerText}>
            {rental.plan.name} · {formatSom(rental.plan.price)}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const DAY_S = 24 * 60 * 60;

/**
 * Seconds until the rental ends, ticking locally off the server's timestamp.
 *
 * Local ticks off an absolute expiry cannot drift the way a locally decremented
 * counter would — every second it recomputes from `expiresAt` rather than
 * subtracting one from itself. Same pattern as `ReservationBanner`.
 *
 * It does not act on reaching zero: the rental poll already returns null once
 * the sweep runs, and the effect above is the single place that leaves.
 */
function useSecondsLeft(expiresAt: string | null): number {
  const [seconds, setSeconds] = useState(() => remaining(expiresAt));

  useEffect(() => {
    setSeconds(remaining(expiresAt));
    if (expiresAt === null) return;
    const timer = setInterval(() => {
      setSeconds(remaining(expiresAt));
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  return seconds;
}

function remaining(expiresAt: string | null): number {
  if (expiresAt === null) return 0;
  return Math.max(0, (new Date(expiresAt).getTime() - Date.now()) / 1000);
}

const EDGE = 20;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  grow: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: EDGE,
    paddingVertical: spacing.s,
  },
  content: {
    paddingHorizontal: EDGE,
    paddingBottom: spacing.xxl,
    gap: spacing.l,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.l,
    ...outline,
    ...shadows.md,
  },
  // The scooter itself, as large as the screen allows — this is the object the
  // rider has out on the street, and it is the only one.
  heroGlow: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.s,
    ...outline,
    ...shadows.sm,
  },
  heroCode: { ...typography.title, color: colors.text, ...numeric },
  heroModel: { fontSize: 12, ...caps, color: colors.textSecondary },
  state: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.s,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.full,
    paddingHorizontal: spacing.m,
    paddingVertical: 6,
    ...outlineHair,
  },
  stateOn: { backgroundColor: colors.primary },
  stateLabel: { fontSize: 11, ...caps, color: colors.textSecondary },
  stateLabelOn: { color: colors.onPrimary },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    backgroundColor: colors.dangerFaint,
    borderRadius: radius.m,
    padding: spacing.m,
    ...outline,
  },
  noticeText: { ...typography.caption, color: colors.text, flex: 1 },
  until: {
    backgroundColor: colors.surfaceBrand,
    borderRadius: radius.l,
    padding: spacing.l,
    gap: 2,
    ...outline,
    ...shadows.sm,
  },
  untilLabel: { fontSize: 11, ...caps, color: colors.textSecondary },
  // Tabular figures, or every ticking second nudges the whole line sideways.
  untilCountdown: { fontSize: 40, fontWeight: '900', letterSpacing: -1.4, color: colors.text, ...numeric },
  untilTime: { ...typography.caption, color: colors.textSecondary, ...numeric },
  tiles: { flexDirection: 'row', gap: spacing.m },
  tile: {
    flex: 1,
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    padding: spacing.l,
    ...outline,
    ...shadows.sm,
  },
  tileLabel: { fontSize: 11, ...caps, color: colors.textSecondary },
  tileValue: { fontSize: 26, fontWeight: '900', letterSpacing: -0.8, color: colors.text, ...numeric },
  tileUnit: { fontSize: 14, fontWeight: '800' },
  footer: { alignItems: 'center', gap: 2, paddingTop: spacing.s },
  footerText: { ...typography.caption, color: colors.textTertiary },
});
