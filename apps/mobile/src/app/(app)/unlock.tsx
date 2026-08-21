import type { Vehicle } from '@ozothunder/shared';
import { formatSom } from '@ozothunder/shared';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { ApiRequestError, apiFetch } from '@/api/client';
import { usePlans, useStartRide, useSubscriptions } from '@/api/queries';
import { ErrorState, ListSkeleton } from '@/components/states';
import { Button, Card, Icon, Pill, Row } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { DURATION, useMotion } from '@/lib/motion';
import {
  batteryColour,
  caps,
  colors,
  outline,
  outlineHair,
  radius,
  shadows,
  spacing,
  typography,
} from '@/lib/theme';

const SCREEN_PADDING = 20;

export default function UnlockScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { qr } = useLocalSearchParams<{ qr: string }>();
  const qrCode = qr ?? '';

  const vehicleQuery = useQuery({
    queryKey: ['vehicleByQr', qrCode],
    queryFn: () => apiFetch<Vehicle>(`/vehicles/by-qr/${qrCode}`),
    enabled: qrCode.length > 0,
  });
  const plansQuery = usePlans();
  const subscriptionsQuery = useSubscriptions();
  const startRide = useStartRide();

  const vehicle = vehicleQuery.data ?? null;

  // The tariff is implicit: an active subscription on this scooter covers the
  // ride, otherwise it is pay-per-minute. Buying day/week plans lives in the
  // subscription flow, not here.
  const subscription =
    subscriptionsQuery.data?.items.find(
      (item) => item.vehicleId === vehicle?.id && item.status === 'active',
    ) ?? null;
  const perMinutePlan = plansQuery.data?.items.find((plan) => plan.kind === 'per_minute') ?? null;
  const effectivePlanId = subscription?.planId ?? perMinutePlan?.id ?? null;

  const unlock = () => {
    if (effectivePlanId === null) return;
    startRide.mutate(
      { qrCode, planId: effectivePlanId },
      {
        onSuccess: async () => {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.replace('/ride');
        },
        onError: (cause) => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          // Signed in with Google or Telegram and no number on file yet. This
          // is the one point a phone is actually required, so send them to
          // link one rather than showing a dead end — /verify comes back here.
          if (cause instanceof ApiRequestError && cause.code === 'phone_required') {
            router.push('/link-phone');
          }
        },
      },
    );
  };

  const error = startRide.error instanceof ApiRequestError ? startRide.error : null;
  const alreadyActive = error?.code === 'ride_already_active';
  const retryable = error?.code === 'unlock_failed';

  if (vehicleQuery.isPending || plansQuery.isPending || subscriptionsQuery.isPending) {
    return (
      <SafeAreaView style={styles.safe}>
        <ListSkeleton rows={3} />
      </SafeAreaView>
    );
  }

  if (vehicleQuery.isError || vehicle === null) {
    return (
      <SafeAreaView style={styles.safe}>
        <ErrorState
          onRetry={() => void vehicleQuery.refetch()}
          message={
            vehicleQuery.error instanceof ApiRequestError && vehicleQuery.error.status === 404
              ? t.vehicleUnavailable
              : undefined
          }
        />
        <View style={styles.footer}>
          <Button label={t.cancel} onPress={() => router.back()} variant="secondary" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Text style={styles.title}>{t.unlockTitle}</Text>

        <ScooterFigure unlocking={startRide.isPending} failed={retryable} />

        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.vehicleBadge}>
              <Icon name="scooter" size={22} color={colors.text} />
            </View>
            <View style={styles.vehicleInfo}>
              <Text style={styles.vehicleCode}>{vehicle.qrCode}</Text>
              <Text style={styles.vehicleModel}>{vehicle.model}</Text>
            </View>
            <Text style={[styles.batteryValue, { color: batteryColour(vehicle.batteryPct) }]}>
              {vehicle.batteryPct}%
            </Text>
          </View>

          {subscription !== null ? (
            <Pill label={t.subscriptionCovered} colour={colors.primary} faint={colors.primaryFaint} />
          ) : perMinutePlan !== null ? (
            <>
              <Row label={t.pricing} value={`${formatSom(perMinutePlan.price)}${t.perMinute}`} />
              <Row label={t.unlockFee} value={formatSom(perMinutePlan.unlockFee)} />
            </>
          ) : null}
        </Card>

        {error !== null && (
          <View style={styles.errorCard}>
            <View style={styles.errorHeader}>
              <Icon name="alert" size={18} color={colors.danger} />
              <Text style={styles.errorTitle}>
                {alreadyActive ? t.rideAlreadyActive : t.unlockFailedTitle}
              </Text>
            </View>
            {/* The gateway's failure reason is demo-relevant: it rotates
                through realistic hardware faults. Show it verbatim. */}
            {!alreadyActive && <Text style={styles.errorBody}>{error.message}</Text>}
          </View>
        )}
      </View>

      <View style={styles.footer}>
        {alreadyActive ? (
          <Button label={t.goToRide} onPress={() => router.replace('/ride')} />
        ) : (
          <Button
            label={startRide.isPending ? t.unlocking : retryable ? t.retry : t.unlock}
            onPress={unlock}
            loading={startRide.isPending}
            disabled={effectivePlanId === null}
            variant={retryable ? 'danger' : 'primary'}
            testID="unlock-button"
          />
        )}
        <Button label={t.cancel} onPress={() => router.back()} variant="ghost" />
      </View>
    </SafeAreaView>
  );
}

/**
 * The unlock animation: idle scooter, a pulsing ring while the command is in
 * flight (the gateway takes 1.2–2 s by design), a shake when the simulated
 * 8% failure fires.
 */
function ScooterFigure({ unlocking, failed }: { unlocking: boolean; failed: boolean }) {
  const ring = useSharedValue(0);
  const shake = useSharedValue(0);
  const { reduced, duration } = useMotion();

  useEffect(() => {
    // The pulsing ring is an ongoing-state indicator rather than a transition,
    // so it keeps its 900ms loop — but it must not loop at all when the OS
    // asks for reduced motion.
    if (unlocking && !reduced) {
      ring.value = 0;
      ring.value = withRepeat(withTiming(1, { duration: 900 }), -1);
    } else {
      cancelAnimation(ring);
      ring.value = withTiming(0, { duration: duration(DURATION.base) });
    }
  }, [unlocking, reduced, duration, ring]);

  useEffect(() => {
    if (failed && !reduced) {
      shake.value = 0;
      shake.value = withSpring(1, { damping: 2, stiffness: 400 }, () => {
        shake.value = 0;
      });
    }
  }, [failed, reduced, shake]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: unlocking ? 1 - ring.value : 0,
    transform: [{ scale: 1 + ring.value * 0.45 }],
  }));
  const figureStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shake.value * 8 * Math.sin(shake.value * Math.PI * 6) }],
  }));

  return (
    <View style={styles.figureArea}>
      <Animated.View style={[styles.ring, ringStyle]} />
      <Animated.View style={[styles.figure, failed && styles.figureFailed, figureStyle]}>
        {/* Ink on both fills — the figure is volt at rest and pale red once it
            has failed, and the glyph has to stay readable on each. */}
        <Icon name={failed ? 'alert' : 'scooter'} size={48} color={colors.text} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, padding: SCREEN_PADDING, gap: spacing.l },
  title: { ...typography.title, color: colors.text, textAlign: 'center' },
  figureArea: {
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 112,
    height: 112,
    borderRadius: 56,
    borderWidth: 3,
    borderColor: colors.primaryInk,
  },
  figure: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...outline,
    ...shadows.md,
  },
  figureFailed: { backgroundColor: colors.dangerFaint },
  card: { gap: spacing.m },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  vehicleBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceBrand,
    alignItems: 'center',
    justifyContent: 'center',
    ...outlineHair,
  },
  vehicleInfo: { flex: 1 },
  vehicleCode: { ...typography.heading, color: colors.text },
  vehicleModel: { fontSize: 12, ...caps, color: colors.textSecondary, marginTop: 2 },
  batteryValue: { ...typography.heading, fontVariant: ['tabular-nums'] },
  errorCard: {
    backgroundColor: colors.dangerFaint,
    borderRadius: radius.l,
    padding: spacing.l,
    gap: spacing.s,
    ...outline,
  },
  errorHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  errorTitle: { fontSize: 13, ...caps, color: colors.text, flex: 1 },
  errorBody: { ...typography.body, color: colors.text },
  footer: { padding: SCREEN_PADDING, gap: spacing.s },
});
