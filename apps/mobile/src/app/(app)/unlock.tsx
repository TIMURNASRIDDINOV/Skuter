import type { Vehicle } from '@scoot/shared';
import { formatSom } from '@scoot/shared';
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
import { Button, Pill, Row } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { batteryColour, colors, radius, spacing, typography } from '@/lib/theme';

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
        onError: () => {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
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

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View>
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
        </View>

        {error !== null && (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>
              {alreadyActive ? t.rideAlreadyActive : t.unlockFailedTitle}
            </Text>
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

  useEffect(() => {
    if (unlocking) {
      ring.value = 0;
      ring.value = withRepeat(withTiming(1, { duration: 900 }), -1);
    } else {
      cancelAnimation(ring);
      ring.value = withTiming(0, { duration: 200 });
    }
  }, [unlocking, ring]);

  useEffect(() => {
    if (failed) {
      shake.value = 0;
      shake.value = withSpring(1, { damping: 2, stiffness: 400 }, () => {
        shake.value = 0;
      });
    }
  }, [failed, shake]);

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
        <Text style={styles.figureGlyph}>{failed ? '🔒' : '🛴'}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  body: { flex: 1, padding: spacing.xl, gap: spacing.l },
  title: { ...typography.title, color: colors.text, textAlign: 'center' },
  figureArea: {
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: colors.primary,
  },
  figure: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: colors.primaryFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  figureFailed: { backgroundColor: colors.dangerFaint },
  figureGlyph: { fontSize: 44 },
  card: {
    backgroundColor: colors.background,
    borderRadius: radius.l,
    padding: spacing.l,
    gap: spacing.m,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  vehicleCode: { ...typography.heading, color: colors.text },
  vehicleModel: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  batteryValue: { ...typography.heading },
  errorCard: {
    backgroundColor: colors.dangerFaint,
    borderRadius: radius.m,
    padding: spacing.l,
    gap: spacing.xs,
  },
  errorTitle: { ...typography.label, color: colors.danger },
  errorBody: { ...typography.body, color: colors.text },
  footer: { padding: spacing.xl, gap: spacing.s },
});
