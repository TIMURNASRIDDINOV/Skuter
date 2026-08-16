import { BottomSheetFlatList, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import type { Plan, Vehicle, VehicleStatus } from '@scoot/shared';
import { formatSom, haversineDistanceM, RESERVATION_HOLD_MS } from '@scoot/shared';
import { useMemo } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { EmptyState } from '@/components/states';
import { planTitle } from '@/components/TariffPicker';
import { TariffPicker } from '@/components/TariffPicker';
import { BatteryBar, Button, Caps, Icon, IconButton } from '@/components/ui';
import { rideMinutesLeft, walkMinutes } from '@/lib/fleet';
import { formatDistance, formatMinutes } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Strings } from '@/lib/i18n';
import {
  batteryColour,
  caps,
  colors,
  numeric,
  outline,
  outlineHair,
  radius,
  shadows,
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
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={() => onSelect(item.vehicle)}
        >
          <View
            style={[
              styles.rowBadge,
              { backgroundColor: `${VEHICLE_STATUS_COLOUR[item.vehicle.status]}33` },
            ]}
          >
            <Icon name="scooter" size={22} color={colors.text} />
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
          <Icon name="chevronRight" size={16} color={colors.text} />
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
      {/* Identity: a volt disc, the number the rider is looking for, and the
          status word — the reference app's card header, with our data in it. */}
      <View style={styles.identity}>
        <View style={styles.identityBadge}>
          <Icon name="scooter" size={24} color={colors.onPrimary} />
        </View>
        <View style={styles.identityBody}>
          <Text style={styles.identityCode} numberOfLines={1}>
            {vehicle.qrCode}
          </Text>
          {/* The dot carries the status; the word for it appears once, in the
              warning below, and only when it is something the rider must act
              on. Saying «Свободен» twice on a scooter you can simply take is
              noise. */}
          <View style={styles.identityStatus}>
            <View
              style={[styles.statusDot, { backgroundColor: VEHICLE_STATUS_COLOUR[vehicle.status] }]}
            />
            <Text style={styles.identityModel} numberOfLines={1}>
              {vehicle.model}
            </Text>
          </View>
        </View>
        <IconButton
          name="close"
          onPress={onClose}
          size={36}
          background={colors.surfaceElevated}
          accessibilityLabel={t.close}
        />
      </View>

      {/* The three facts that decide whether to walk to this one, each in its
          own outlined tile. Walk time drops out entirely without a position
          fix rather than showing a dash — an empty tile is a worse answer than
          two tiles. */}
      <View style={styles.stats}>
        <StatTile value={`${String(vehicle.batteryPct)}%`} label={t.battery} colour={battery} />
        <StatTile value={formatMinutes(rideMinutesLeft(vehicle), lang)} label={t.range} />
        {distanceM !== null && (
          <StatTile
            value={`${String(walkMinutes(distanceM))} ${t.minutesShort}`}
            label={t.onFoot}
          />
        )}
      </View>

      <BatteryBar pct={vehicle.batteryPct} colour={battery} />

      <Caps style={styles.sectionLabel}>{t.pricing}</Caps>

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
            <Icon name="lock" size={15} color={colors.primaryInk} />
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

/** One outlined fact — a big value over a heavy uppercase caption. */
function StatTile({ value, label, colour }: { value: string; label: string; colour?: string }) {
  return (
    <View style={styles.statTile}>
      <Text style={[styles.statValue, colour !== undefined && { color: colour }]} numberOfLines={1}>
        {value}
      </Text>
      <Caps style={styles.statLabel} color={colors.textSecondary}>
        {label}
      </Caps>
    </View>
  );
}

const styles = StyleSheet.create({
  listContent: { paddingBottom: spacing.xxl },
  separator: { height: spacing.s },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    marginHorizontal: EDGE,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.m,
    backgroundColor: colors.surface,
    borderRadius: radius.m,
    ...outline,
    ...shadows.sm,
  },
  rowPressed: { transform: [{ translateY: 2 }], shadowOffset: { width: 0, height: 0 }, elevation: 0 },
  rowBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    ...outlineHair,
  },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '900', letterSpacing: -0.2, color: colors.text, ...numeric },
  rowSubtitle: { fontSize: 13, fontWeight: '500', color: colors.textSecondary, marginTop: 2 },
  rowMeta: { alignItems: 'flex-end', gap: 2 },
  rowBattery: { fontSize: 15, fontWeight: '900', ...numeric },
  rowDistance: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  detail: { paddingHorizontal: EDGE, paddingBottom: spacing.xl, gap: spacing.m },
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.m },
  identityBadge: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...outline,
  },
  identityBody: { flex: 1, gap: 2 },
  identityCode: { ...typography.title, fontSize: 24, color: colors.text, ...numeric },
  identityStatus: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 9, height: 9, borderRadius: 5, ...outlineHair },
  identityModel: { fontSize: 12, ...caps, color: colors.textSecondary, flex: 1 },
  stats: { flexDirection: 'row', gap: spacing.s },
  statTile: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.m,
    paddingHorizontal: spacing.s,
    paddingVertical: spacing.m,
    ...outline,
  },
  statValue: { fontSize: 17, fontWeight: '900', letterSpacing: -0.4, color: colors.text, ...numeric },
  statLabel: { fontSize: 10, textAlign: 'center' },
  sectionLabel: { marginTop: spacing.xs },
  tariffLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 2 },
  tariffLinkLabel: { ...typography.label, color: colors.textSecondary },
  unavailable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    backgroundColor: colors.warningFaint,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.m,
    ...outline,
  },
  unavailableText: { fontSize: 13, ...caps, color: colors.text, flex: 1 },
  actions: { gap: spacing.s, marginTop: spacing.xs },
  heldNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s,
    paddingVertical: spacing.m,
  },
  heldNoteText: { ...typography.label, color: colors.primaryInk },
  footnote: { ...typography.caption, color: colors.textTertiary, textAlign: 'center' },
});
