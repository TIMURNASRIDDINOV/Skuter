import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { formatSom } from '@scoot/shared';
import Constants from 'expo-constants';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useProfile, useSubscriptions } from '@/api/queries';
import { useSession } from '@/api/session';
import { Icon, MenuRow } from '@/components/ui';
import { formatPhone } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { colors, numeric, radius, spacing, typography } from '@/lib/theme';

/** Screen-edge inset, matching the other sheet content. */
const EDGE = 20;

/**
 * Everything that is not the map, one tap behind the ☰ control.
 *
 * The map screen has no tab bar and no section switcher — this sheet is the
 * whole of the app's navigation, so it is the only place Профиль, Подписки,
 * История and the zone legend are reachable from.
 *
 * Deliberately short. The app it is modelled on also offers promo codes, a
 * payment method, and help — none of which have an endpoint behind them here,
 * and the first two are on the project's explicit not-building list. A tile
 * that does nothing is worse in a client demo than a tile that is absent.
 */
export function MenuSheet({
  onShowNearby,
  onNavigate,
}: {
  onShowNearby: () => void;
  /** Closes the sheet before pushing — a route must not open behind it. */
  onNavigate: (href: '/profile' | '/rent' | '/history' | '/rules') => void;
}) {
  const { t } = useI18n();
  const { user } = useSession();
  const profileQuery = useProfile();
  const subscriptionsQuery = useSubscriptions();

  const activeCount = (subscriptionsQuery.data?.items ?? []).filter(
    (subscription) => subscription.status === 'active',
  ).length;

  // The session copy carries the name and phone; /me carries the balance, which
  // rides change. Both are already fetched elsewhere on this screen.
  const name = user?.name ?? null;
  const phone = user?.phone ?? null;
  const balance = profileQuery.data?.balance ?? null;

  return (
    <BottomSheetScrollView contentContainerStyle={styles.content}>
      <Pressable
        accessibilityRole="button"
        testID="menu-profile"
        onPress={() => onNavigate('/profile')}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{name ?? t.menuProfile}</Text>
          <Text style={styles.cardMeta}>
            {phone !== null ? formatPhone(phone) : 'Telegram'}
          </Text>
        </View>
        <View style={styles.avatar}>
          <Icon name="person" size={22} color={colors.textSecondary} />
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        onPress={() => onNavigate('/rent')}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <View style={styles.cardBody}>
          <Text style={styles.cardTitle}>{t.menuRent}</Text>
          <Text style={styles.cardMeta}>
            {activeCount > 0 ? `${t.active} · ${String(activeCount)}` : t.noSubscriptions}
          </Text>
        </View>
        <View style={styles.avatar}>
          <Icon name="ticket" size={22} color={colors.primary} />
        </View>
      </Pressable>

      <View style={styles.tiles}>
        {/* Not a button: the balance is read-only here — there is no top-up
            endpoint, and a mock payment provider is not a wallet. */}
        <View style={styles.tile}>
          <View style={[styles.tileBadge, { backgroundColor: colors.primaryFaint }]}>
            <Icon name="wallet" size={20} color={colors.primary} />
          </View>
          <View>
            <Text style={styles.tileValue}>{balance === null ? '—' : formatSom(balance)}</Text>
            <Text style={styles.tileLabel}>{t.balance}</Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          testID="menu-history"
          onPress={() => onNavigate('/history')}
          style={({ pressed }) => [styles.tile, pressed && styles.cardPressed]}
        >
          <View style={[styles.tileBadge, { backgroundColor: colors.surfaceMuted }]}>
            <Icon name="history" size={20} color={colors.textSecondary} />
          </View>
          <View>
            <Text style={styles.tileLabel}>{t.menuHistory}</Text>
          </View>
        </Pressable>
      </View>

      <View style={styles.rows}>
        <MenuRow icon="scooter" label={t.menuNearby} onPress={onShowNearby} />
        <MenuRow
          icon="parking"
          label={t.menuRules}
          onPress={() => onNavigate('/rules')}
          testID="menu-rules"
        />
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>{t.legalInfo}</Text>
        <Text style={styles.footerText}>
          {t.appVersion} {Constants.expoConfig?.version ?? '—'}
        </Text>
      </View>
    </BottomSheetScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: EDGE, paddingBottom: spacing.xxl, gap: spacing.m },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.l,
    padding: spacing.l,
  },
  cardPressed: { backgroundColor: colors.surfaceMuted },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { ...typography.heading, color: colors.text },
  cardMeta: { ...typography.label, color: colors.textSecondary },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tiles: { flexDirection: 'row', gap: spacing.m },
  tile: {
    flex: 1,
    minHeight: 128,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.l,
    padding: spacing.l,
    // Badge pinned to the top, text to the bottom — otherwise the tile with a
    // value above its label and the tile without one sit their labels on two
    // different baselines, and a two-tile row reads as misaligned.
    justifyContent: 'space-between',
  },
  tileBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileValue: { fontSize: 20, fontWeight: '800', color: colors.text, ...numeric },
  tileLabel: { ...typography.body, fontWeight: '600', color: colors.text },
  rows: { backgroundColor: colors.surfaceElevated, borderRadius: radius.l, padding: spacing.xs },
  footer: { paddingTop: spacing.s, gap: spacing.xs, alignItems: 'center' },
  footerText: { ...typography.caption, color: colors.textTertiary },
});
