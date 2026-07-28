import type { SubscriptionDetail } from '@scoot/shared';
import { formatSom } from '@scoot/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '@/api/session';
import { useRideHistory, useSubscriptions, useUpdateProfile } from '@/api/queries';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/states';
import { Button, Card, Pill, Row } from '@/components/ui';
import { formatDate, formatDateTime, formatDistance, formatDuration, formatPhone } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Language, Strings } from '@/lib/i18n';
import { colors, radius, spacing, typography } from '@/lib/theme';

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
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backGlyph}>←</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{t.profileTitle}</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Card style={styles.section}>
          <Text style={styles.phone}>{user !== null ? formatPhone(user.phone) : ''}</Text>
          <Row label={t.balance} value={user !== null ? formatSom(user.balance) : '—'} />
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
          <View style={styles.langRow}>
            {(['ru', 'uz'] as Language[]).map((code) => (
              <Pressable
                key={code}
                style={[styles.langOption, lang === code && styles.langOptionActive]}
                onPress={() => setLang(code)}
              >
                <Text style={[styles.langLabel, lang === code && styles.langLabelActive]}>
                  {code === 'ru' ? 'Русский' : 'O‘zbekcha'}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        <Text style={styles.sectionHeading}>{t.mySubscriptions}</Text>
        {subscriptionsQuery.isPending ? (
          <ListSkeleton rows={1} />
        ) : subscriptionsQuery.isError ? (
          <ErrorState onRetry={() => void subscriptionsQuery.refetch()} />
        ) : subscriptionsQuery.data.items.length === 0 ? (
          <EmptyState title={t.noSubscriptions} emoji="🎫" />
        ) : (
          subscriptionsQuery.data.items.map((subscription) => {
            const meta = subscriptionStatusMeta(subscription.status, t);
            return (
              <Card key={subscription.id} style={styles.section}>
                <View style={styles.subHeader}>
                  <Text style={styles.subTitle}>{subscription.plan.name}</Text>
                  <Pill label={meta.label} colour={meta.colour} faint={meta.faint} />
                </View>
                <Text style={styles.subVehicle}>
                  {subscription.vehicle.qrCode} · {subscription.vehicle.model}
                </Text>
                <Text style={styles.subExpiry}>
                  {t.until} {formatDate(subscription.expiresAt, lang)}
                </Text>
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
          <EmptyState title={t.noRides} />
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
                <View style={styles.rideBody}>
                  <Text style={styles.rideDate}>{formatDateTime(ride.startedAt, lang)}</Text>
                  <Text style={styles.rideMeta}>
                    {formatDuration(ride.durationS)} · {formatDistance(ride.distanceM, lang)}
                  </Text>
                </View>
                <Text style={styles.rideCost}>{formatSom(ride.cost)}</Text>
              </Pressable>
            ))}
          </Card>
        )}

        <Button label={t.logout} onPress={confirmLogout} variant="secondary" style={styles.logout} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.s,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backGlyph: { fontSize: 18, color: colors.text },
  headerTitle: { ...typography.heading, color: colors.text, flex: 1, textAlign: 'center' },
  content: { padding: spacing.l, gap: spacing.m, paddingBottom: spacing.xxl },
  section: { gap: spacing.s },
  phone: { ...typography.title, color: colors.text },
  nameRow: { flexDirection: 'row', gap: spacing.s, alignItems: 'center' },
  nameInput: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.m,
    height: 44,
  },
  saveButton: { minHeight: 44, paddingVertical: 0, paddingHorizontal: spacing.l },
  sectionTitle: { ...typography.label, color: colors.textSecondary },
  langRow: { flexDirection: 'row', gap: spacing.s },
  langOption: {
    flex: 1,
    height: 44,
    borderRadius: radius.m,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langOptionActive: { borderColor: colors.primary, backgroundColor: colors.primaryFaint },
  langLabel: { ...typography.body, color: colors.textSecondary },
  langLabelActive: { color: colors.primaryPressed, fontWeight: '600' },
  sectionHeading: { ...typography.heading, color: colors.text, marginTop: spacing.m },
  subHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  subTitle: { ...typography.heading, color: colors.text },
  subVehicle: { ...typography.body, color: colors.text },
  subExpiry: { ...typography.body, color: colors.textSecondary },
  rideList: { paddingVertical: 0 },
  rideRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.m,
    gap: spacing.m,
  },
  rideRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rideBody: { flex: 1, gap: 2 },
  rideDate: { ...typography.body, color: colors.text, fontWeight: '600' },
  rideMeta: { ...typography.caption, color: colors.textSecondary },
  rideCost: { ...typography.body, color: colors.text, fontWeight: '600' },
  logout: { marginTop: spacing.l },
});
