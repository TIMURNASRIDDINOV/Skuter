import type { Plan } from '@scoot/shared';
import { formatSom, formatSomAmount, RESERVATION_HOLD_MS } from '@scoot/shared';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Icon } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { Strings } from '@/lib/i18n';
import {
  caps,
  colors,
  numeric,
  outline,
  radius,
  shadows,
  spacing,
  typography,
} from '@/lib/theme';

/** The label under a plan's name — what it actually buys you. */
export function planSubtitle(plan: Plan, t: Strings): string {
  switch (plan.kind) {
    case 'per_minute':
      return t.tariffAnywhere;
    case 'daily':
      return t.tariffForDay;
    case 'weekly':
      return t.tariffForWeek;
  }
}

export function planTitle(plan: Plan, t: Strings): string {
  return plan.kind === 'per_minute' ? t.tariffPerMinute : plan.name;
}

/**
 * Tariffs side by side, chosen in place.
 *
 * Buying a pass used to mean leaving for `/plans`, which put a screen
 * transition between "I want this scooter" and "on what terms" — the two
 * halves of one decision. The reference app settles both in the same sheet and
 * it is plainly better: the prices are comparable because they are adjacent.
 *
 * `/plans` still exists and is still reachable from Аренда, for buying a pass
 * without a scooter in mind.
 */
export function TariffPicker({
  plans,
  selectedId,
  onSelect,
}: {
  plans: Plan[];
  selectedId: string | null;
  onSelect: (plan: Plan) => void;
}) {
  const { t } = useI18n();

  return (
    <View style={styles.picker}>
      <View style={styles.row}>
      {plans.map((plan) => {
        const active = plan.id === selectedId;
        return (
          <Pressable
            key={plan.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (active) return;
              void Haptics.selectionAsync();
              onSelect(plan);
            }}
            style={[styles.tile, active && styles.tileActive]}
          >
            <Text
              style={[styles.tileTitle, active && styles.tileTitleActive]}
              numberOfLines={1}
            >
              {planTitle(plan, t)}
            </Text>
            <Text style={styles.tileSubtitle} numberOfLines={1}>
              {planSubtitle(plan, t)}
            </Text>
            {/* The amount without its currency word. Three tiles across a
                phone leave ~90pt each, and «250 000 so'm/мин» truncated to
                «250 000 s…» — which loses the unit *and* the digits' meaning.
                The currency is stated once, under the tiles. */}
            <Text style={[styles.tilePrice, active && styles.tilePriceActive]} numberOfLines={1}>
              {formatSomAmount(plan.price)}
              {plan.kind === 'per_minute' && (
                <Text style={styles.tilePriceUnit}>{t.perMinute}</Text>
              )}
            </Text>
          </Pressable>
        );
      })}
      </View>
      <Text style={styles.currencyNote}>{t.pricesInSom}</Text>
    </View>
  );
}

/**
 * The full price of the selected tariff, opened from the sheet.
 *
 * Lists only what we actually charge — `unlockFee`, the per-minute rate, and
 * the free hold. The reference app's «Ожидание» and «Депозит» rows are absent
 * because this system has neither, and inventing them here would put a number
 * on screen that no receipt could ever justify.
 */
export function TariffDetails({ plan, onClose }: { plan: Plan; onClose: () => void }) {
  const { t } = useI18n();
  const perMinute = plan.kind === 'per_minute';

  return (
    <View style={styles.details}>
      <Text style={styles.detailsTitle}>{planTitle(plan, t)}</Text>
      <View style={styles.divider} />

      <DetailRow
        label={t.tariffStart}
        value={plan.unlockFee === 0 ? t.free : formatSom(plan.unlockFee)}
      />
      <DetailRow
        label={t.tariffRide}
        value={perMinute ? `${formatSom(plan.price)}${t.perMinute}` : formatSom(plan.price)}
      />
      <DetailRow
        label={t.tariffFreeHold}
        value={`${String(Math.round(RESERVATION_HOLD_MS / 60_000))} ${t.minutesShort}`}
      />
      {!perMinute && (
        <View style={styles.note}>
          <Icon name="info" size={15} color={colors.textSecondary} />
          <Text style={styles.noteText}>{t.tariffBoundToVehicle}</Text>
        </View>
      )}

      <Button label={t.close} variant="secondary" onPress={onClose} style={styles.closeButton} />
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  picker: { gap: spacing.s },
  row: { flexDirection: 'row', gap: spacing.s },
  currencyNote: { ...typography.caption, color: colors.textTertiary, textAlign: 'right' },
  // Every tile is outlined, selected or not — the outline is the tile's edge,
  // not its selected state. Selection is carried by the volt fill and the
  // shadow lifting off the page, which survives being seen out of the corner
  // of the eye in a way a border-colour change does not.
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.m,
    gap: 1,
    ...outline,
  },
  tileActive: { backgroundColor: colors.primary, ...shadows.md },
  // Smaller and much tighter than the `caps` default. Three tiles across a
  // phone leave ~90pt of text each, and plan names come from the database —
  // «НЕДЕЛЬНЫЙ» at 12sp/0.8 ellipsised to «НЕДЕЛЬН…», which is not a tariff.
  tileTitle: { ...caps, fontSize: 11, letterSpacing: 0.1, color: colors.textSecondary },
  tileTitleActive: { color: colors.text },
  // `textSecondary`, not tertiary: this line has to stay legible on the volt
  // fill of the selected tile as well as on the white of the others.
  tileSubtitle: { ...typography.caption, fontWeight: '600', color: colors.textSecondary },
  tilePrice: {
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.4,
    color: colors.text,
    marginTop: spacing.xs,
    ...numeric,
  },
  tilePriceActive: { color: colors.onPrimary },
  tilePriceUnit: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  details: { paddingHorizontal: 20, paddingBottom: spacing.xl, gap: spacing.s },
  detailsTitle: { ...typography.title, color: colors.text },
  divider: { height: 2, backgroundColor: colors.border, marginVertical: spacing.s },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.m,
  },
  detailLabel: { ...typography.body, color: colors.textSecondary },
  detailValue: { fontSize: 16, fontWeight: '900', color: colors.text, ...numeric },
  note: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, paddingVertical: spacing.s },
  noteText: { ...typography.caption, color: colors.textSecondary, flex: 1 },
  closeButton: { marginTop: spacing.m },
});
