import { formatSom } from '@ozothunder/shared';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRideHistory } from '@/api/queries';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states';
import { Card, Icon, ScreenHeader } from '@/components/ui';
import { formatDateTime, formatDistance, formatDuration } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { caps, colors, numeric, outline, radius, shadows, spacing, typography } from '@/lib/theme';

/**
 * Every ride this rider has taken, newest first.
 *
 * Lifted out of the profile screen, which is settings now. A completed ride
 * opens its receipt; one still in flight is not tappable, because there is
 * nothing to receipt yet.
 */
export default function HistoryScreen() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const ridesQuery = useRideHistory();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={t.rideHistory} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content}>
        {ridesQuery.isPending ? (
          <ListSkeleton rows={4} />
        ) : ridesQuery.isError ? (
          <ErrorState onRetry={() => void ridesQuery.refetch()} />
        ) : ridesQuery.data.items.length === 0 ? (
          <EmptyState title={t.noRides} icon="history" />
        ) : (
          <Card style={styles.list}>
            {ridesQuery.data.items.map((ride, i) => (
              <Pressable
                key={ride.id}
                style={[styles.row, i > 0 && styles.rowBorder]}
                disabled={ride.status !== 'completed'}
                onPress={() => router.push({ pathname: '/receipt', params: { rideId: ride.id } })}
              >
                <View style={styles.badge}>
                  <Icon name="history" size={20} color={colors.text} />
                </View>
                <View style={styles.body}>
                  <Text style={styles.date}>{formatDateTime(ride.startedAt, lang)}</Text>
                  <Text style={styles.meta}>
                    {formatDuration(ride.durationS)} · {formatDistance(ride.distanceM, lang)}
                  </Text>
                </View>
                <Text style={styles.cost}>{formatSom(ride.cost)}</Text>
                {ride.status === 'completed' && (
                  <Icon name="chevronRight" size={14} color={colors.textSecondary} />
                )}
              </Pressable>
            ))}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: 20,
    paddingTop: spacing.s,
    paddingBottom: spacing.xxl,
    gap: spacing.m,
  },
  list: { paddingVertical: 0, gap: spacing.s },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.m,
    gap: spacing.m,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    ...outline,
    ...shadows.sm,
  },
  // Each ride is its own outlined card now, so the rule that used to separate
  // them would be a second edge drawn on top of an edge.
  rowBorder: {},
  badge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceBrand,
    alignItems: 'center',
    justifyContent: 'center',
    ...outline,
  },
  body: { flex: 1, gap: 2 },
  date: { ...typography.body, color: colors.text, fontWeight: '800' },
  meta: { fontSize: 12, ...caps, color: colors.textSecondary },
  cost: { fontSize: 16, fontWeight: '900', color: colors.text, ...numeric },
});
