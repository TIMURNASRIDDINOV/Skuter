import { BottomSheetFlatList, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import type { Plan, Vehicle, VehicleStatus } from '@scoot/shared';
import { formatSom, haversineDistanceM, RESERVATION_HOLD_MS } from '@scoot/shared';
import { useMemo } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { EmptyState } from '@/components/states';
import { planTitle } from '@/components/TariffPicker';
import { TariffPicker } from '@/components/TariffPicker';
import { BatteryBar, Button, Chip, Icon, IconButton } from '@/components/ui';
import { rideMinutesLeft, walkMinutes } from '@/lib/fleet';
import { formatDistance, formatMinutes } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Strings } from '@/lib/i18n';
import {
  batteryColour,
  colors,
  numeric,
  radius,
  spacing,
  typography,
  VEHICLE_STATUS_COLOUR,
} from '@/lib/theme';

/** Screen-edge inset — a touch wider than spacing.l so the sheet never feels cramped. */
const EDGE = 20;

export function statusLabel(status: VehicleStatus, t: Strings): string {
  switch (status) {
    case 'available':
      return t.statusAvailable;
    case 'low_battery':
      return t.statusLowBattery;
    case 'in_use':
      return t.statusInUse;
    case 'reserved':
      return t.statusReserved;
    case 'offline':
      return t.statusOffline;
    case 'maintenance':
      return t.statusMaintenance;
  }
}

interface NearbyListProps {
  vehicles: Vehicle[];
  centre: { lat: number; lon: number };
  refreshing: boolean;
  onRefresh: () => void;
  onSelect: (vehicle: Vehicle) => void;
  /** Rendered above the list — the carousel and the menu rows. */
  header: React.ReactElement;
}

/**
 * The full fleet, under the carousel.
 *
 * Pull-to-refresh here re-fetches vehicles AND zones — demo step 7.
 */
export function NearbyList({
  vehicles,
  centre,
  refreshing,
  onRefresh,
  onSelect,
  header,
}: NearbyListProps) {
  const { t, lang } = useI18n();

  const sorted = useMemo(
    () =>
      vehicles
        .map((vehicle) => ({ vehicle, distanceM: haversineDistanceM(centre, vehicle.location) }))
        .sort((a, b) => a.distanceM - b.distanceM),
    [vehicles, centre],
  );

  return (
    <BottomSheetFlatList
      data={sorted}
      keyExtractor={(item) => item.vehicle.id}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
      ListHeaderComponent={header}
      ListEmptyComponent={<EmptyState title={t.emptyVehicles} hint={t.emptyVehiclesHint} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      contentContainerStyle={styles.listContent}
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
          onPress={() => onSelect(item.vehicle)}
        >
          <View
            style={[
              styles.rowBadge,
              { backgroundColor: `${VEHICLE_STATUS_COLOUR[item.vehicle.status]}1A` },
            ]}
          >
            <Icon name="scooter" size={22} color={VEHICLE_STATUS_COLOUR[item.vehicle.status]} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>{item.vehicle.qrCode}</Text>
            <Text style={styles.rowSubtitle}>
              {walkMinutes(item.distanceM)} {t.walkMinutes} ·{' '}
              {formatMinutes(rideMinutesLeft(item.vehicle), lang)}
            </Text>
          </View>
          <View style={styles.rowMeta}>
            <Text style={[styles.rowBattery, { color: batteryColour(item.vehicle.batteryPct) }]}>
              {item.vehicle.batteryPct}%
            </Text>
            <Text style={styles.rowDistance}>{formatDistance(item.distanceM, lang)}</Text>
          </View>
          <Icon name="chevronRight" size={16} color={colors.textSecondary} />
        </Pressable>
      )}
    />
  );
}

interface VehicleDetailProps {
  vehicle: Vehicle;
  /** Every plan on offer, per-minute first. */
  plans: Plan[];
  selectedPlan: Plan | null;
  /** Walk distance from the rider, or null with no position fix. */
  distanceM: number | null;
  /** True when this rider already holds this scooter. */
  held: boolean;
  reserving: boolean;
  onSelectPlan: (plan: Plan) => void;
  onShowTariff: () => void;
  onUnlock: () => void;
  onReserve: () => void;
  onClose: () => void;
}

/**
 * Sheet content after tapping a pin — demo step 1.
 *
 * **This scrolls, and it has to.** The content is taller than the sheet's
 * resting snap point on a short phone, and taller than every snap point once
 * the OS font scale is turned up — rendered in a plain `BottomSheetView` the
 * action buttons were simply cut off with no way to reach them. The sheet
 * offers a taller stop to drag to (see `snapPoints` in the map screen); this
 * scroll view is what guarantees nothing is unreachable either way.
 */
export function VehicleDetail({
  vehicle,
  plans,
  selectedPlan,
  distanceM,
  held,
  reserving,
  onSelectPlan,
  onShowTariff,
  onUnlock,
  onReserve,
  onClose,
}: VehicleDetailProps) {
  const { t, lang } = useI18n();
  const rideable = vehicle.status === 'available' || vehicle.status === 'reserved';
  const battery = batteryColour(vehicle.batteryPct);
  const holdMinutes = Math.round(RESERVATION_HOLD_MS / 60_000);

  return (
    <BottomSheetScrollView
      contentContainerStyle={styles.detail}
      showsVerticalScrollIndicator={false}
      // Reads as a panel that happens to scroll, not as a list.
      bounces={false}
    >
      {/* Identity block: the number the rider is looking for, the two facts
          that decide whether to take it, and the glyph that makes the whole
          thing scannable — the reference app's card, in our palette. */}
      <View style={styles.hero}>
        <View style={styles.heroBody}>
          <Text style={styles.heroCode} numberOfLines={1}>
            {vehicle.qrCode}
          </Text>
          <View style={styles.heroChips}>
            <Chip
              label={`${String(vehicle.batteryPct)}%`}
              colour={battery}
              background={`${battery}1F`}
            />
            <Chip
              icon="clock"
              label={formatMinutes(rideMinutesLeft(vehicle), lang)}
              colour={colors.textSecondary}
              background={colors.surface}
            />
            {distanceM !== null && (
              <Chip
                icon="walk"
                label={`${String(walkMinutes(distanceM))} ${t.minutesShort}`}
                colour={colors.textSecondary}
                background={colors.surface}
              />
            )}
          </View>
          <BatteryBar pct={vehicle.batteryPct} colour={battery} />
        </View>
        <Icon name="scooter" size={64} color={colors.surfaceMuted} style={styles.heroGlyph} />
      </View>

      <View style={styles.headerRow}>
        <Text style={styles.sectionLabel}>{t.pricing}</Text>
        <IconButton
          name="close"
          onPress={onClose}
          size={32}
          background={colors.surfaceElevated}
          color={colors.textSecondary}
          style={styles.closeButton}
          accessibilityLabel={t.close}
        />
      </View>

      {plans.length > 0 && (
        <TariffPicker plans={plans} selectedId={selectedPlan?.id ?? null} onSelect={onSelectPlan} />
      )}

      {selectedPlan !== null && (
        <Pressable
          onPress={onShowTariff}
          style={({ pressed }) => [styles.tariffLink, pressed && { opacity: 0.6 }]}
          testID="tariff-details"
        >
          <Text style={styles.tariffLinkLabel}>{t.tariffDetails}</Text>
          <Icon name="chevronRight" size={13} color={colors.textSecondary} />
        </Pressable>
      )}

      {!rideable && (
        <View style={styles.unavailable}>
          <Icon name="alert" size={16} color={colors.warning} />
          <Text style={styles.unavailableText}>{statusLabel(vehicle.status, t)}</Text>
        </View>
      )}

      {/* Stacked, not side by side. Split down the middle, «Разблокировать»
          does not fit on one line at any supported width and wrapped to a
          stray «ь» on the second row. Full width also gives the primary action
          the weight it has in the reference app. */}
      <View style={styles.actions}>
        <Button label={t.unlock} onPress={onUnlock} disabled={!rideable} testID="unlock-button" />
        {!held && (
          <Button
            label={`${t.reserveFor} ${String(holdMinutes)} ${t.minutesShort}`}
            onPress={onReserve}
            variant="secondary"
            disabled={!rideable}
            loading={reserving}
            testID="reserve-button"
          />
        )}
        {held && (
          <View style={styles.heldNote}>
            <Icon name="lock" size={15} color={colors.primaryPressed} />
            <Text style={styles.heldNoteText}>{t.reservedHint}</Text>
          </View>
        )}
      </View>

      {selectedPlan !== null && (
        <Text style={styles.footnote}>
          {selectedPlan.unlockFee === 0
            ? t.free
            : `${t.tariffStart} ${formatSom(selectedPlan.unlockFee)}`}
          {selectedPlan.kind === 'per_minute' &&
            ` · ${t.thenPerMinute} ${formatSom(selectedPlan.price)}${t.perMinute}`}
          {selectedPlan.kind !== 'per_minute' && ` · ${planTitle(selectedPlan, t)}`}
        </Text>
      )}
    </BottomSheetScrollView>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: spacing.xxl },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginLeft: EDGE + 44 + spacing.m,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingHorizontal: EDGE,
    paddingVertical: spacing.m,
  },
  rowBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2, color: colors.text, ...numeric },
  rowSubtitle: { fontSize: 13, fontWeight: '400', color: colors.textSecondary, marginTop: 2 },
  rowMeta: { alignItems: 'flex-end', gap: 2 },
  rowBattery: { fontSize: 15, fontWeight: '700', ...numeric },
  rowDistance: { fontSize: 13, fontWeight: '400', color: colors.textSecondary },
  detail: { paddingHorizontal: EDGE, paddingBottom: spacing.xl, gap: spacing.m },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.l,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.l,
    overflow: 'hidden',
  },
  heroBody: { flex: 1, gap: spacing.s },
  heroCode: { ...typography.title, color: colors.text, ...numeric },
  heroChips: { flexDirection: 'row', gap: spacing.xs + 2, flexWrap: 'wrap' },
  heroGlyph: { marginRight: -spacing.l, opacity: 0.9 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  closeButton: { shadowOpacity: 0, elevation: 0 },
  tariffLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 2 },
  tariffLinkLabel: { ...typography.label, color: colors.textSecondary },
  unavailable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    backgroundColor: colors.warningFaint,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
  },
  unavailableText: { ...typography.label, color: colors.text },
  actions: { gap: spacing.s, marginTop: spacing.xs },
  heldNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s,
    paddingVertical: spacing.m,
  },
  heldNoteText: { ...typography.label, color: colors.primaryPressed },
  footnote: { ...typography.caption, color: colors.textTertiary, textAlign: 'center' },
});
