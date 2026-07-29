import { formatSom } from '@scoot/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useReceipt } from '@/api/queries';
import { ErrorState, ListSkeleton } from '@/components/states';
import { Button, Card, Icon, Pill, Row } from '@/components/ui';
import { formatDateTime, formatDistance, formatDuration } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { colors, spacing, typography } from '@/lib/theme';

const SCREEN_PADDING = 20;

export default function ReceiptScreen() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const receiptQuery = useReceipt(rideId ?? '');

  if (receiptQuery.isPending) {
    return (
      <SafeAreaView style={styles.safe}>
        <ListSkeleton rows={4} />
      </SafeAreaView>
    );
  }

  if (receiptQuery.isError) {
    return (
      <SafeAreaView style={styles.safe}>
        <ErrorState onRetry={() => void receiptQuery.refetch()} />
        <View style={styles.footer}>
          <Button label={t.toMap} onPress={() => router.replace('/')} variant="secondary" />
        </View>
      </SafeAreaView>
    );
  }

  const { ride, breakdown, planName, endZoneName } = receiptQuery.data;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <View style={styles.headerBlock}>
          <Animated.View entering={ZoomIn.springify()} style={styles.badge}>
            <Icon name="check" size={40} color={colors.primary} />
          </Animated.View>
          <Text style={styles.title}>{t.receiptTitle}</Text>
          {ride.endedAt !== null && (
            <Text style={styles.meta}>{formatDateTime(ride.endedAt, lang)}</Text>
          )}
        </View>

        <Animated.View entering={FadeInDown.delay(150)}>
          <Text style={styles.total}>{formatSom(breakdown.total)}</Text>
          {breakdown.coveredBySubscription && (
            <View style={styles.covered}>
              <Pill
                label={t.coveredBySubscription}
                colour={colors.primary}
                faint={colors.primaryFaint}
              />
            </View>
          )}
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(250)}>
          <Card style={styles.card}>
            <Row label={t.duration} value={formatDuration(breakdown.durationS)} />
            <Row label={t.distance} value={formatDistance(breakdown.distanceM, lang)} />
            <Row label={t.plan} value={planName} />
            {!breakdown.coveredBySubscription && (
              <>
                <Row label={t.unlockFee} value={formatSom(breakdown.unlockFee)} />
                <Row
                  label={`${t.timeFee} (${breakdown.chargedMinutes} ${t.chargedMinutes} × ${formatSom(breakdown.ratePerMinute)})`}
                  value={formatSom(breakdown.timeFee)}
                />
              </>
            )}
            <View style={styles.divider} />
            <Row
              label={t.total}
              value={formatSom(breakdown.total)}
              valueStyle={styles.totalRowValue}
            />
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(350)}>
          <Card style={styles.card}>
            <Row label={t.receiptStarted} value={formatDateTime(ride.startedAt, lang)} />
            {ride.endedAt !== null && (
              <Row label={t.receiptEnded} value={formatDateTime(ride.endedAt, lang)} />
            )}
            {endZoneName !== null && <Row label={t.parkedAt} value={endZoneName} />}
          </Card>
        </Animated.View>
      </View>

      <View style={styles.footer}>
        <Button label={t.done} onPress={() => router.replace('/')} testID="receipt-done" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, padding: SCREEN_PADDING, gap: spacing.l, alignItems: 'stretch' },
  headerBlock: { alignItems: 'center', gap: spacing.s, marginTop: spacing.l },
  badge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primaryFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.heading, color: colors.text, textAlign: 'center' },
  meta: { ...typography.label, color: colors.textSecondary, textAlign: 'center' },
  total: {
    ...typography.display,
    color: colors.text,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  covered: { alignItems: 'center', marginTop: spacing.s },
  card: { gap: 0 },
  divider: {
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderColor: colors.border,
    marginVertical: spacing.s,
  },
  totalRowValue: { ...typography.heading, color: colors.text, fontVariant: ['tabular-nums'] },
  footer: { padding: SCREEN_PADDING },
});
