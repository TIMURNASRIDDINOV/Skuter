import type { SubscriptionDetail } from '@scoot/shared';
import { formatSom } from '@scoot/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '@/api/session';
import { useRideHistory, useSubscriptions, useUpdateProfile } from '@/api/queries';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states';
import { Button, Card, Icon, Pill } from '@/components/ui';
import { formatDate, formatDateTime, formatDistance, formatDuration, formatPhone } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Language, Strings } from '@/lib/i18n';
import { colors, radius, shadows, spacing, typography } from '@/lib/theme';

function subscriptionStatusMeta(status: SubscriptionDetail['status'], t: Strings) {
  switch (status) {
    case 'active':
      return { label: t.active, colour: colors.primary, faint: colors.primaryFaint };
    case 'expired':
      return { label: t.expired, colour: colors.textSecondary, faint: colors.surfaceMuted };
    case 'cancelled':
      return { label: t.cancelled, colour: colors.danger, faint: colors.dangerFaint };
  }
}

export default function ProfileScreen() {
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  const { user, setUser, signOut } = useSession();

  const subscriptionsQuery = useSubscriptions();
  const ridesQuery = useRideHistory();
  const updateProfile = useUpdateProfile();

  const [name, setName] = useState(user?.name ?? '');
  const dirty = name.trim() !== (user?.name ?? '');

  const saveName = () => {
    const next = name.trim() === '' ? null : name.trim();
    updateProfile.mutate(
      { name: next },
      { onSuccess: (profile) => setUser(profile) },
    );
  };

  const confirmLogout = () => {
    Alert.alert(t.logout, undefined, [
      { text: t.cancel, style: 'cancel' },
      { text: t.logout, style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t.profileTitle}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.section}>
          <Text style={styles.phone}>
            {user === null ? '' : user.phone !== null ? formatPhone(user.phone) : 'Telegram'}
          </Text>
          <View style={styles.balanceRow}>
            <View style={styles.iconBadge}>
              <Icon name="wallet" size={20} color={colors.primary} />
            </View>
            <View style={styles.balanceBody}>
              <Text style={styles.balanceLabel}>{t.balance}</Text>
              <Text style={styles.balanceValue}>
                {user !== null ? formatSom(user.balance) : '—'}
              </Text>
            </View>
          </View>
          <View style={styles.nameRow}>
            <TextInput
              style={styles.nameInput}
              value={name}
              onChangeText={setName}
              placeholder={t.namePlaceholder}
              placeholderTextColor={colors.textSecondary}
            />
            {dirty && (
              <Button
                label={t.save}
                onPress={saveName}
                loading={updateProfile.isPending}
                style={styles.saveButton}
              />
            )}
          </View>
        </Card>

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>{t.language}</Text>
          <View style={styles.segmentTrack}>
            {(['ru', 'uz'] as Language[]).map((code) => (
              <Pressable
                key={code}
                style={[styles.segment, lang === code && styles.segmentActive]}
                onPress={() => setLang(code)}
              >
                <Text style={[styles.segmentLabel, lang === code && styles.segmentLabelActive]}>
                  {code === 'ru' ? 'Русский' : 'O‘zbekcha'}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        {/* Аренда is not linked from here any more — it is the second half of
            the map screen's Общий / Аренда switcher, same as the mini app. */}

        <Text style={styles.sectionHeading}>{t.mySubscriptions}</Text>
        {subscriptionsQuery.isPending ? (
          <ListSkeleton rows={1} />
        ) : subscriptionsQuery.isError ? (
          <ErrorState onRetry={() => void subscriptionsQuery.refetch()} />
        ) : subscriptionsQuery.data.items.length === 0 ? (
          <EmptyState title={t.noSubscriptions} icon="ticket" />
        ) : (
          subscriptionsQuery.data.items.map((subscription) => {
            const meta = subscriptionStatusMeta(subscription.status, t);
            return (
              <Card key={subscription.id} style={styles.section}>
                <View style={styles.subRow}>
                  <View style={styles.iconBadge}>
                    <Icon name="ticket" size={20} color={colors.primary} />
                  </View>
                  <View style={styles.subBody}>
                    <View style={styles.subHeader}>
                      <Text style={styles.subTitle}>{subscription.plan.name}</Text>
                      <Pill label={meta.label} colour={meta.colour} faint={meta.faint} />
                    </View>
                    <Text style={styles.subMeta}>
                      {subscription.vehicle.qrCode} · {subscription.vehicle.model}
                    </Text>
                    <Text style={styles.subMeta}>
                      {t.until} {formatDate(subscription.expiresAt, lang)}
                    </Text>
                  </View>
                </View>
              </Card>
            );
          })
        )}

        <Text style={styles.sectionHeading}>{t.rideHistory}</Text>
        {ridesQuery.isPending ? (
          <ListSkeleton rows={3} />
        ) : ridesQuery.isError ? (
          <ErrorState onRetry={() => void ridesQuery.refetch()} />
        ) : ridesQuery.data.items.length === 0 ? (
          <EmptyState title={t.noRides} icon="history" />
        ) : (
          <Card style={styles.rideList}>
            {ridesQuery.data.items.map((ride, i) => (
              <Pressable
                key={ride.id}
                style={[styles.rideRow, i > 0 && styles.rideRowBorder]}
                disabled={ride.status !== 'completed'}
                onPress={() =>
                  router.push({ pathname: '/receipt', params: { rideId: ride.id } })
                }
              >
                <View style={styles.historyBadge}>
                  <Icon name="history" size={20} color={colors.textSecondary} />
                </View>
                <View style={styles.rideBody}>
                  <Text style={styles.rideDate}>{formatDateTime(ride.startedAt, lang)}</Text>
                  <Text style={styles.rideMeta}>
                    {formatDuration(ride.durationS)} · {formatDistance(ride.distanceM, lang)}
                  </Text>
                </View>
                <Text style={styles.rideCost}>{formatSom(ride.cost)}</Text>
                {ride.status === 'completed' && (
                  <Icon name="chevronRight" size={14} color={colors.textSecondary} />
                )}
              </Pressable>
            ))}
          </Card>
        )}

        <Pressable accessibilityRole="button" style={styles.logoutRow} onPress={confirmLogout}>
          <View style={styles.logoutBadge}>
            <Icon name="logout" size={20} color={colors.danger} />
          </View>
          <Text style={styles.logoutLabel}>{t.logout}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: spacing.s,
  },
  headerTitle: { ...typography.heading, color: colors.text, flex: 1, textAlign: 'center' },
  content: {
    paddingHorizontal: 20,
    paddingTop: spacing.s,
    paddingBottom: spacing.xxl,
    gap: spacing.m,
  },
  section: { gap: spacing.m },
  phone: { ...typography.heading, color: colors.text },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  balanceBody: { flex: 1, gap: 2 },
  balanceLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  balanceValue: { ...typography.display, color: colors.text, fontVariant: ['tabular-nums'] },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primaryFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameRow: { flexDirection: 'row', gap: spacing.s, alignItems: 'center' },
  nameInput: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    height: 48,
  },
  saveButton: { minHeight: 48, paddingVertical: 0, paddingHorizontal: spacing.l },
  sectionTitle: { ...typography.label, color: colors.textSecondary },
  segmentTrack: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.s,
    padding: 3,
  },
  segment: {
    flex: 1,
    height: 40,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: { backgroundColor: colors.surface, ...shadows.sm },
  segmentLabel: { ...typography.label, color: colors.textSecondary },
  segmentLabelActive: { color: colors.text },
  sectionHeading: { ...typography.heading, color: colors.text, marginTop: spacing.m },
  subRow: { flexDirection: 'row', gap: spacing.m, alignItems: 'flex-start' },
  subBody: { flex: 1, gap: spacing.xs },
  subHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  subTitle: { ...typography.heading, color: colors.text },
  subMeta: { ...typography.label, color: colors.textSecondary },
  rideList: { paddingVertical: 0 },
  rideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.m,
    gap: spacing.m,
  },
  rideRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  historyBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rideBody: { flex: 1, gap: 2 },
  rideDate: { ...typography.body, color: colors.text, fontWeight: '600' },
  rideMeta: { ...typography.label, color: colors.textSecondary },
  rideCost: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    padding: spacing.l,
    marginTop: spacing.l,
    ...shadows.sm,
  },
  logoutBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.dangerFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutLabel: { ...typography.body, fontWeight: '600', color: colors.danger },
});
