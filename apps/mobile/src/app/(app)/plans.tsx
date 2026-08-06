import type { Plan, Vehicle } from '@scoot/shared';
import { formatSom } from '@scoot/shared';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { ApiRequestError, apiFetch } from '@/api/client';
import { useBuySubscription, usePlans } from '@/api/queries';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states';
import { Button, Icon, IconButton } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Strings } from '@/lib/i18n';
import { colors, radius, shadows, spacing, typography } from '@/lib/theme';

function daysWord(days: number, t: Strings): string {
  if (days % 10 === 1 && days % 100 !== 11) return t.day;
  if ([2, 3, 4].includes(days % 10) && ![12, 13, 14].includes(days % 100)) return t.days2_4;
  return t.days5;
}

export default function PlansScreen() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const params = useLocalSearchParams<{
    vehicleId?: string;
    qr?: string;
    model?: string;
    /** Preselected by the map sheet's tariff picker — the rider already chose. */
    planId?: string;
  }>();

  const plansQuery = usePlans();
  const buy = useBuySubscription();
  // Arriving from the sheet's tariff picker, the choice is already made — land
  // on it selected rather than making the rider pick the same plan twice.
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(params.planId ?? null);
  const [purchased, setPurchased] = useState(false);

  // Reached from the map, the caller already knows the vehicle. Reached by
  // scanning from the Аренда screen, it knows only the code on the sticker —
  // so resolve it here rather than making every caller look it up first.
  const scannedQuery = useQuery({
    queryKey: ['vehicleByQr', params.qr],
    queryFn: () => apiFetch<Vehicle>(`/vehicles/by-qr/${params.qr ?? ''}`),
    enabled: params.vehicleId === undefined && (params.qr ?? '').length > 0,
  });

  const vehicleId = params.vehicleId ?? scannedQuery.data?.id;
  const vehicleQr = params.qr ?? scannedQuery.data?.qrCode ?? '';
  const vehicleModel = params.model ?? scannedQuery.data?.model ?? '';

  const subscribable = (plansQuery.data?.items ?? []).filter(
    (plan): plan is Plan & { durationDays: number } =>
      plan.kind !== 'per_minute' && plan.durationDays !== null,
  );
  const selected = subscribable.find((plan) => plan.id === selectedPlanId) ?? null;

  if (scannedQuery.isPending && params.vehicleId === undefined && (params.qr ?? '') !== '') {
    return (
      <SafeAreaView style={styles.safe}>
        <Header title={t.plansTitle} onBack={() => router.back()} />
        <ListSkeleton rows={3} />
      </SafeAreaView>
    );
  }

  // Deep-linked here without a scooter — a subscription binds to one.
  if (vehicleId === undefined) {
    return (
      <SafeAreaView style={styles.safe}>
        <Header title={t.plansTitle} onBack={() => router.back()} />
        <EmptyState title={t.pickVehicleFirst} icon="scooter" style={styles.grow} />
        <View style={styles.footer}>
          {/* Nothing was bought — this one really does want the map. */}
          <Button label={t.toMap} onPress={() => router.replace('/')} variant="secondary" />
        </View>
      </SafeAreaView>
    );
  }

  if (purchased && selected !== null) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={[styles.grow, styles.success]}>
          <Animated.View entering={ZoomIn.springify()}>
            <Icon name="check" size={72} color={colors.primary} />
          </Animated.View>
          <Text style={styles.successTitle}>{t.purchaseSuccessTitle}</Text>
          <Text style={styles.successHint}>
            {vehicleQr} — {t.until} {formatDate(expiry(selected.durationDays), lang)}
          </Text>
          <Text style={styles.successNote}>{t.purchaseSuccessHint}</Text>
        </View>
        <View style={styles.footer}>
          {/* Back to Аренда, where the pass they just bought is now listed. */}
          <Button
            label={t.toMap}
            onPress={() => router.replace({ pathname: '/', params: { section: 'rent' } })}
            testID="subscription-done"
          />
        </View>
      </SafeAreaView>
    );
  }

  const buyError =
    buy.error instanceof ApiRequestError
      ? buy.error.code === 'payment_failed'
        ? t.paymentFailed
        : buy.error.code === 'vehicle_unavailable'
          ? t.alreadySubscribed
          : t.loadingError
      : buy.isError
        ? t.loadingError
        : null;

  return (
    <SafeAreaView style={styles.safe}>
      <Header title={t.plansTitle} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.subtitle}>
          {t.choosePlanFor} {vehicleQr}
          {vehicleModel !== '' ? ` · ${vehicleModel}` : ''}
        </Text>
        <Text style={styles.note}>{t.plansSubtitle}</Text>

        {plansQuery.isPending ? (
          <ListSkeleton rows={2} />
        ) : plansQuery.isError ? (
          <ErrorState onRetry={() => void plansQuery.refetch()} />
        ) : subscribable.length === 0 ? (
          <EmptyState title={t.noPlans} icon="ticket" />
        ) : (
          subscribable.map((plan, i) => {
            const active = plan.id === selectedPlanId;
            return (
              <Animated.View key={plan.id} entering={FadeInDown.delay(i * 80)}>
                <Pressable
                  style={[styles.planCard, active && styles.planCardActive]}
                  onPress={() => setSelectedPlanId(plan.id)}
                  testID={`plan-${plan.kind}`}
                >
                  <View style={styles.planHeader}>
                    <Text style={styles.planName}>{plan.name}</Text>
                    <View style={[styles.radio, active && styles.radioActive]}>
                      {active && <View style={styles.radioDot} />}
                    </View>
                  </View>
                  <Text style={styles.planPrice}>{formatSom(plan.price)}</Text>
                  <Text style={styles.planDuration}>
                    {plan.durationDays} {daysWord(plan.durationDays, t)}
                  </Text>
                </Pressable>
              </Animated.View>
            );
          })
        )}

        {buyError !== null && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{buyError}</Text>
          </View>
        )}
      </ScrollView>

      {selected !== null && (
        <View style={styles.footer}>
          <Text style={styles.expiryNote}>
            {vehicleQr} — {t.until} {formatDate(expiry(selected.durationDays), lang)}
          </Text>
          <Button
            label={`${t.buyFor} ${formatSom(selected.price)}`}
            loading={buy.isPending}
            onPress={() => {
              buy.mutate(
                { planId: selected.id, vehicleId },
                {
                  onSuccess: async () => {
                    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    setPurchased(true);
                  },
                  onError: () => {
                    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                  },
                },
              );
            }}
            testID="buy-plan"
          />
        </View>
      )}
    </SafeAreaView>
  );
}

function expiry(durationDays: number): string {
  return new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <IconButton name="back" onPress={onBack} size={40} />
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  grow: { flex: 1, justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: spacing.s,
  },
  headerSpacer: { width: 40, height: 40 },
  headerTitle: { ...typography.heading, color: colors.text, flex: 1, textAlign: 'center' },
  list: { paddingHorizontal: 20, paddingVertical: spacing.l, gap: spacing.m },
  subtitle: { ...typography.heading, color: colors.text },
  note: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.s },
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: spacing.l,
    gap: spacing.xs,
    ...shadows.sm,
  },
  planCardActive: { borderColor: colors.primary, backgroundColor: colors.primaryFaint },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planName: { ...typography.heading, color: colors.text },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: colors.primary },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
  planPrice: {
    ...typography.title,
    color: colors.primaryPressed,
    fontVariant: ['tabular-nums'],
  },
  planDuration: { ...typography.label, color: colors.textSecondary },
  errorCard: {
    backgroundColor: colors.dangerFaint,
    borderRadius: radius.m,
    padding: spacing.l,
  },
  errorText: { ...typography.body, color: colors.danger },
  footer: {
    padding: 20,
    gap: spacing.m,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    ...shadows.lg,
  },
  expiryNote: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  success: { alignItems: 'center', gap: spacing.m, padding: spacing.xl },
  successTitle: { ...typography.title, color: colors.text, textAlign: 'center' },
  successHint: { ...typography.heading, color: colors.text },
  successNote: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
});
