import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '@/api/session';
import { useUpdateProfile } from '@/api/queries';
import { Button, Icon, ScreenHeader } from '@/components/ui';
import { formatPhone } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Language } from '@/lib/i18n';
import { caps, colors, outline, outlineHair, radius, shadows, spacing, typography } from '@/lib/theme';

/**
 * Settings, not a dashboard.
 *
 * Subscriptions and ride history used to pile up under here; both are their own
 * routes off the ☰ sheet now, which leaves this screen doing one job — the few
 * things about the account a rider can actually change.
 *
 * The reference design also carries an email row, notification toggles and
 * "delete account". None of them have an endpoint behind them, and push
 * notifications are on the project's explicit not-building list, so they are
 * absent rather than present and dead.
 */
export default function ProfileScreen() {
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  const { user, setUser, signOut } = useSession();
  const updateProfile = useUpdateProfile();

  const [name, setName] = useState(user?.name ?? '');
  const dirty = name.trim() !== (user?.name ?? '');

  const saveName = () => {
    const next = name.trim() === '' ? null : name.trim();
    updateProfile.mutate({ name: next }, { onSuccess: (profile) => setUser(profile) });
  };

  const confirmLogout = () => {
    Alert.alert(t.logout, undefined, [
      { text: t.cancel, style: 'cancel' },
      { text: t.logout, style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  // The rider's own initial, or a person glyph before they have given a name.
  const initial = user?.name?.trim().charAt(0).toUpperCase() ?? null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScreenHeader title={t.profileTitle} onBack={() => router.back()} />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.avatar}>
          {initial === null || initial === '' ? (
            <Icon name="person" size={36} color={colors.onPrimary} />
          ) : (
            <Text style={styles.avatarInitial}>{initial}</Text>
          )}
        </View>

        <Text style={styles.sectionTitle}>{t.personalSection}</Text>
        <View style={styles.group}>
          {/* Read-only: the phone is the account's identity, and changing it
              would be a re-verification flow, not a text field. */}
          <View style={styles.readonlyRow}>
            <Text style={styles.rowLabel}>{t.phoneLabel}</Text>
            <Text style={styles.rowValue}>
              {user === null ? '' : user.phone !== null ? formatPhone(user.phone) : 'Telegram'}
            </Text>
          </View>

          <View style={styles.nameRow}>
            <Text style={styles.rowLabel}>{t.namePrompt}</Text>
            <View style={styles.nameField}>
              <TextInput
                style={styles.nameInput}
                value={name}
                onChangeText={setName}
                // The row's own label already asks the question; a second copy
                // of it inside the field only overflows the field.
                placeholder={t.nameLabel}
                placeholderTextColor={colors.textTertiary}
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
          </View>
        </View>

        <Text style={styles.sectionTitle}>{t.language}</Text>
        <View style={styles.group}>
          <View style={styles.segmentTrack}>
            {(['ru', 'uz', 'zh-Hant'] as Language[]).map((code) => (
              <Pressable
                key={code}
                accessibilityRole="button"
                accessibilityState={{ selected: lang === code }}
                style={[styles.segment, lang === code && styles.segmentActive]}
                onPress={() => setLang(code)}
              >
                <Text style={[styles.segmentLabel, lang === code && styles.segmentLabelActive]}>
                  {code === 'ru' ? 'Русский' : code === 'uz' ? 'O‘zbekcha' : '繁體中文'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Text style={styles.sectionTitle}>{t.accountSection}</Text>
        <Pressable accessibilityRole="button" style={styles.logoutRow} onPress={confirmLogout}>
          <Text style={styles.logoutLabel}>{t.logout}</Text>
          <Icon name="logout" size={20} color={colors.danger} />
        </Pressable>
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
    gap: spacing.s,
  },
  avatar: {
    alignSelf: 'center',
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.l,
    ...outline,
    ...shadows.md,
  },
  avatarInitial: { fontSize: 40, fontWeight: '900', color: colors.onPrimary },
  sectionTitle: {
    fontSize: 12,
    ...caps,
    color: colors.textSecondary,
    marginTop: spacing.m,
    paddingHorizontal: spacing.xs,
  },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    padding: spacing.l,
    gap: spacing.m,
    ...outline,
    ...shadows.sm,
  },
  readonlyRow: { gap: 2 },
  rowLabel: { fontSize: 12, ...caps, color: colors.textSecondary },
  rowValue: { ...typography.body, color: colors.text, fontWeight: '800' },
  nameRow: { gap: spacing.s },
  nameField: { flexDirection: 'row', gap: spacing.s, alignItems: 'center' },
  nameInput: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    height: 48,
    // `outlineHair` is a ViewStyle: spreading it here widens the whole entry
    // and stops it matching TextStyle — the same trap `numeric` is annotated
    // against in theme.ts. Written out rather than spread.
    borderWidth: 1,
    borderColor: colors.border,
  },
  saveButton: { minHeight: 48, paddingVertical: 0, paddingHorizontal: spacing.l },
  segmentTrack: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.m,
    padding: 4,
    gap: 4,
    ...outline,
  },
  segment: {
    flex: 1,
    height: 40,
    borderRadius: radius.s,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: { backgroundColor: colors.primary, ...outlineHair },
  segmentLabel: { fontSize: 13, ...caps, color: colors.textSecondary },
  segmentLabelActive: { color: colors.text },
  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    padding: spacing.l,
    ...outline,
    ...shadows.sm,
  },
  logoutLabel: { fontSize: 15, ...caps, color: colors.danger },
});
