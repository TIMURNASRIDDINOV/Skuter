import type { Plan } from '@scoot/shared';
import { formatSom } from '@scoot/shared';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { ApiRequestError } from '@/api/client';
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
  const params = useLocalSearchParams<{ vehicleId?: string; qr?: string; model?: string }>();

  const plansQuery = usePlans();
  const buy = useBuySubscription();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [purchased, setPurchased] = useState(false);

  const subscribable = (plansQuery.data?.items ?? []).filter(
    (plan): plan is Plan & { durationDays: number } =>
      plan.kind !== 'per_minute' && plan.durationDays !== null,
  );
  const selected = subscribable.find((plan) => plan.id === selectedPlanId) ?? null;

  // Deep-linked here without a scooter — a subscription binds to one.
  if (params.vehicleId === undefined) {
    return (
      <SafeAreaView style={styles.safe}>
        <Header title={t.plansTitle} onBack={() => router.back()} />
        <EmptyState title={t.pickVehicleFirst} icon="scooter" style={styles.grow} />
        <View style={styles.footer}>
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
            {params.qr} — {t.until} {formatDate(expiry(selected.durationDays), lang)}
          </Text>
          <Text style={styles.successNote}>{t.purchaseSuccessHint}</Text>
        </View>
        <View style={styles.footer}>
          <Button label={t.toMap} onPress={() => router.replace('/')} testID="subscription-done" />
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
          {t.choosePlanFor} {params.qr}
          {params.model !== undefined ? ` · ${params.model}` : ''}
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
            {params.qr} — {t.until} {formatDate(expiry(selected.durationDays), lang)}
          </Text>
          <Button
            label={`${t.buyFor} ${formatSom(selected.price)}`}
            loading={buy.isPending}
            onPress={() => {
              buy.mutate(
                { planId: selected.id, vehicleId: params.vehicleId ?? '' },
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
