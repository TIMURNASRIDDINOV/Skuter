import { BottomSheetFlatList, BottomSheetView } from '@gorhom/bottom-sheet';
import type { Plan, Vehicle, VehicleStatus } from '@scoot/shared';
import { formatSom, haversineDistanceM } from '@scoot/shared';
import { useMemo } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { EmptyState } from '@/components/states';
import { BatteryBar, Button, Pill } from '@/components/ui';
import { formatDistance } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { Strings } from '@/lib/i18n';
import { batteryColour, colors, radius, spacing, typography, VEHICLE_STATUS_COLOUR } from '@/lib/theme';

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
}

/**
 * The sheet's resting content: scooters sorted by distance from the map
 * centre. Pull-to-refresh here re-fetches vehicles AND zones — demo step 7.
 */
export function NearbyList({ vehicles, centre, refreshing, onRefresh, onSelect }: NearbyListProps) {
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
      ListHeaderComponent={
        <Text style={styles.listTitle}>
          {sorted.length}{' '}
          {sorted.length % 10 === 1 && sorted.length % 100 !== 11
            ? t.scooterNearbyOne
            : t.scootersNearby}
        </Text>
      }
      ListEmptyComponent={<EmptyState title={t.emptyVehicles} hint={t.emptyVehiclesHint} />}
      contentContainerStyle={styles.listContent}
      renderItem={({ item }) => (
        <Pressable
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
          onPress={() => onSelect(item.vehicle)}
        >
          <View
            style={[styles.rowPin, { backgroundColor: VEHICLE_STATUS_COLOUR[item.vehicle.status] }]}
          >
            <Text style={styles.rowPinGlyph}>🛴</Text>
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle}>{item.vehicle.qrCode}</Text>
            <Text style={styles.rowSubtitle}>{item.vehicle.model}</Text>
          </View>
          <View style={styles.rowMeta}>
            <Text style={[styles.rowBattery, { color: batteryColour(item.vehicle.batteryPct) }]}>
              {item.vehicle.batteryPct}%
            </Text>
            <Text style={styles.rowDistance}>{formatDistance(item.distanceM, lang)}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}

interface VehicleDetailProps {
  vehicle: Vehicle;
  perMinutePlan: Plan | null;
  onUnlock: () => void;
  onSubscribe: () => void;
  onClose: () => void;
}

/** Sheet content after tapping a pin: battery, range and pricing — demo step 1. */
export function VehicleDetail({
  vehicle,
  perMinutePlan,
  onUnlock,
  onSubscribe,
  onClose,
}: VehicleDetailProps) {
  const { t, lang } = useI18n();
  const rideable = vehicle.status === 'available' || vehicle.status === 'reserved';

  return (
    <BottomSheetView style={styles.detail}>
      <View style={styles.detailHeader}>
        <View style={styles.detailHeading}>
          <Text style={styles.detailTitle}>{vehicle.qrCode}</Text>
          <Text style={styles.detailSubtitle}>{vehicle.model}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeGlyph}>✕</Text>
        </Pressable>
      </View>

      <Pill
        label={statusLabel(vehicle.status, t)}
        colour={VEHICLE_STATUS_COLOUR[vehicle.status]}
      />

      <View style={styles.detailStats}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>{t.battery}</Text>
          <Text style={[styles.statValue, { color: batteryColour(vehicle.batteryPct) }]}>
            {vehicle.batteryPct}%
          </Text>
          <BatteryBar pct={vehicle.batteryPct} colour={batteryColour(vehicle.batteryPct)} />
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>{t.range}</Text>
          <Text style={styles.statValue}>{formatDistance(vehicle.rangeM, lang)}</Text>
        </View>
      </View>

      {perMinutePlan !== null && (
        <View style={styles.pricing}>
          <Text style={styles.statLabel}>{t.pricing}</Text>
          <Text style={styles.pricingValue}>
            {formatSom(perMinutePlan.price)}
            {t.perMinute}
          </Text>
          <Text style={styles.pricingHint}>
            {t.unlockFee}: {formatSom(perMinutePlan.unlockFee)}
          </Text>
        </View>
      )}

      <View style={styles.actions}>
        <Button label={t.unlock} onPress={onUnlock} disabled={!rideable} style={styles.actionMain} />
        <Button label={t.subscribe} onPress={onSubscribe} variant="secondary" disabled={!rideable} />
      </View>
    </BottomSheetView>
  );
}

const styles = StyleSheet.create({
  listTitle: {
    ...typography.heading,
    color: colors.text,
    paddingHorizontal: spacing.l,
    paddingBottom: spacing.s,
  },
  listContent: { paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.m,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
  },
  rowPin: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowPinGlyph: { fontSize: 20 },
  rowBody: { flex: 1 },
  rowTitle: { ...typography.body, fontWeight: '600', color: colors.text },
  rowSubtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  rowMeta: { alignItems: 'flex-end', gap: 2 },
  rowBattery: { ...typography.label },
  rowDistance: { ...typography.caption, color: colors.textSecondary },
  detail: { paddingHorizontal: spacing.l, paddingBottom: spacing.xl, gap: spacing.m },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  detailHeading: { flex: 1 },
  detailTitle: { ...typography.title, color: colors.text },
  detailSubtitle: { ...typography.body, color: colors.textSecondary, marginTop: 2 },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: { fontSize: 14, color: colors.textSecondary },
  detailStats: { flexDirection: 'row', gap: spacing.l },
  stat: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.m,
    padding: spacing.m,
    gap: spacing.xs,
  },
  statLabel: { ...typography.caption, color: colors.textSecondary },
  statValue: { ...typography.heading, color: colors.text },
  pricing: {
    backgroundColor: colors.primaryFaint,
    borderRadius: radius.m,
    padding: spacing.m,
    gap: spacing.xs,
  },
  pricingValue: { ...typography.heading, color: colors.primaryPressed },
  pricingHint: { ...typography.caption, color: colors.textSecondary },
  actions: { flexDirection: 'row', gap: spacing.m, marginTop: spacing.s },
  actionMain: { flex: 1 },
});
