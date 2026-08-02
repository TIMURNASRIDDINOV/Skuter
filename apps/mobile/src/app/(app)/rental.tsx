import type { Plan, SubscriptionDetail } from '@scoot/shared';
import { formatSom } from '@scoot/shared';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { usePlans, useSubscriptions } from '@/api/queries';
import { Button, Card, Icon, Pill } from '@/components/ui';
import { ErrorState, ListSkeleton } from '@/components/states';
import { formatDateTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { colors, spacing, typography } from '@/lib/theme';

/**
 * Аренда: active passes and the daily/weekly plans.
 *
 * A pass binds to one scooter, so buying starts at the scanner — opened with
 * `intent=subscribe`, which sends the read to the plan picker instead of the
 * unlock screen. Without that the button read "scan a scooter and buy" and
 * landed the rider on "unlock and start riding", which is a different thing.
 */
export default function RentalScreen() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const plansQuery = usePlans();
  const subscriptionsQuery = useSubscriptions();

  const plans = (plansQuery.data?.items ?? []).filter((plan) => plan.kind !== 'per_minute');
  const subscriptions = (subscriptionsQuery.data?.items ?? []).filter(
    (sub) => sub.status === 'active',
  );

  if (subscriptionsQuery.isError && subscriptionsQuery.data === undefined) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ErrorState onRetry={() => void subscriptionsQuery.refetch()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t.rentalTitle}</Text>

        <Text style={styles.sectionTitle}>{t.mySubscriptions}</Text>
        {subscriptionsQuery.isLoading ? (
          <ListSkeleton rows={1} />
        ) : subscriptions.length === 0 ? (
          <Card style={styles.card}>
            <Text style={styles.mutedText}>{t.noSubscriptions}</Text>
          </Card>
        ) : (
          subscriptions.map((sub: SubscriptionDetail) => (
            <Card key={sub.id} style={styles.card}>
              <View style={styles.subRow}>
                <View style={styles.iconBadge}>
                  <Icon name="ticket" size={20} color={colors.primary} />
                </View>
                <View style={styles.subBody}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.cardTitle}>{sub.plan.name}</Text>
                    <Pill
                      label={t.active}
                      colour={colors.primaryPressed}
                      faint={colors.primaryFaint}
                    />
                  </View>
                  <Text style={styles.metaText}>
                    {sub.vehicle.qrCode} · {sub.vehicle.model}
                  </Text>
                  <Text style={styles.metaText}>
                    {t.subscriptionUntil} {formatDateTime(sub.expiresAt, lang)}
                  </Text>
                </View>
              </View>
            </Card>
          ))
        )}

        <Text style={styles.sectionTitle}>{t.pricing}</Text>
        {plans.map((plan: Plan) => (
          <Card key={plan.id} style={styles.card}>
            <View style={styles.rowBetween}>
              {/* Plan names come from the database and can be long. Without a
                  flex/shrink split the title ran straight into the price, and
                  a six-figure so'm amount overflowed the card entirely. */}
              <Text style={styles.cardTitle} numberOfLines={2}>
                {plan.name}
              </Text>
              <Text style={styles.price} numberOfLines={1}>
                {formatSom(plan.price)}
              </Text>
            </View>
            <Text style={styles.metaText}>
              {plan.durationDays === 1
                ? t.rentalDailyHint
                : `${t.rentalWeeklyHint} ${String(plan.durationDays ?? 0)} ${t.rentalDays}`}
            </Text>
            <Button
              label={t.rentalScanCta}
              variant="secondary"
              onPress={() => router.push({ pathname: '/scan', params: { intent: 'subscribe' } })}
              style={styles.cta}
            />
          </Card>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: 20,
    paddingTop: spacing.l,
    paddingBottom: spacing.xxl,
    gap: spacing.m,
  },
  title: { ...typography.title, color: colors.text, marginBottom: spacing.s },
  sectionTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: spacing.s,
  },
  card: { gap: spacing.xs },
  subRow: { flexDirection: 'row', gap: spacing.m, alignItems: 'flex-start' },
  subBody: { flex: 1, gap: spacing.xs },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.m,
  },
  cardTitle: { ...typography.heading, color: colors.text, flex: 1 },
  price: {
    ...typography.heading,
    color: colors.primaryPressed,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  metaText: { ...typography.label, color: colors.textSecondary },
  mutedText: { ...typography.body, color: colors.textSecondary },
  cta: { marginTop: spacing.s },
});
