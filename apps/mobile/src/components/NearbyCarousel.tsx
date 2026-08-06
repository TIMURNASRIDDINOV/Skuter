import type { Vehicle } from '@scoot/shared';
import { haversineDistanceM } from '@scoot/shared';
import * as Haptics from 'expo-haptics';
import { useMemo } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Chip, Icon, Skeleton } from '@/components/ui';
import { rideMinutesLeft, walkMinutes } from '@/lib/fleet';
import { formatMinutes } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { batteryColour, colors, numeric, radius, shadows, spacing, typography } from '@/lib/theme';

/** How many cards the carousel offers before "see all" takes over. */
const MAX_CARDS = 8;

const SCAN_BUTTON_SIZE = 88;
const EDGE = 20;

/**
 * The scroller's width, computed rather than flexed.
 *
 * `flex: 1` next to the fixed-size scan button measured at content width here
 * — a horizontal ScrollView inside a list header does not always resolve
 * against a bounded parent — and the cards ran underneath the button. Taking
 * the width from the screen is deterministic, and the app is portrait-locked,
 * the same assumption `lib/map.ts` already evaluates its zoom constants under.
 */
const TRACK_WIDTH =
  Dimensions.get('window').width - SCAN_BUTTON_SIZE - EDGE - 12;

/**
 * Sized so the next card shows a clear slice rather than a hairline. A peek
 * this size is the only thing telling the rider there is more than one
 * candidate; too thin and it reads as a rendering fault instead of an
 * invitation to swipe.
 */
const CARD_PEEK = 40;
const CARD_WIDTH = TRACK_WIDTH - EDGE - CARD_PEEK;

interface NearbyCarouselProps {
  vehicles: Vehicle[];
  /** Where distances are measured from — the rider, or the map centre. */
  origin: { lat: number; lon: number };
  loading: boolean;
  onSelect: (vehicle: Vehicle) => void;
  onScan: () => void;
}

/**
 * The resting content of the map sheet: the few nearest scooters as cards, and
 * the scan button.
 *
 * Replaces the distance-sorted list that used to sit here. A list answers
 * "which scooters exist"; at the moment the app opens the rider is asking
 * "which one do I walk to", and that is a comparison between two or three
 * candidates — so they are laid out side by side with the three facts that
 * decide it (walk time, charge, how long that charge lasts).
 *
 * The full list still exists, one snap point up.
 */
export function NearbyCarousel({
  vehicles,
  origin,
  loading,
  onSelect,
  onScan,
}: NearbyCarouselProps) {
  const { t } = useI18n();

  const nearest = useMemo(
    () =>
      vehicles
        .map((vehicle) => ({ vehicle, distanceM: haversineDistanceM(origin, vehicle.location) }))
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, MAX_CARDS),
    [vehicles, origin],
  );

  return (
    <View style={styles.row}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Without this the scroller sizes to its content and runs underneath
        // the scan button, which then covers the next card.
        style={styles.scroller}
        contentContainerStyle={styles.track}
        // Cards settle one per swipe rather than drifting mid-card.
        snapToInterval={CARD_WIDTH + spacing.m}
        decelerationRate="fast"
      >
        {loading && nearest.length === 0
          ? [0, 1].map((key) => <Skeleton key={key} style={styles.skeleton} />)
          : nearest.map(({ vehicle, distanceM }) => (
              <VehicleCard
                key={vehicle.id}
                vehicle={vehicle}
                distanceM={distanceM}
                onPress={() => onSelect(vehicle)}
              />
            ))}
        {!loading && nearest.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t.emptyVehicles}</Text>
            <Text style={styles.emptyHint}>{t.emptyVehiclesHint}</Text>
          </View>
        )}
      </ScrollView>

      {/* The app's primary action, and the reference app's signature control:
          a circle big enough to hit without looking, parked at the edge of the
          sheet where a thumb already rests. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.scan}
        testID="scan-fab"
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onScan();
        }}
        style={({ pressed }) => [
          styles.scanButton,
          { backgroundColor: pressed ? colors.primaryPressed : colors.primary },
        ]}
      >
        <Text style={styles.scanLabel}>{t.scanCta}</Text>
        <Icon name="scan" size={26} color={colors.textInverse} />
      </Pressable>
    </View>
  );
}

function VehicleCard({
  vehicle,
  distanceM,
  onPress,
}: {
  vehicle: Vehicle;
  distanceM: number;
  onPress: () => void;
}) {
  const { t, lang } = useI18n();
  const battery = batteryColour(vehicle.batteryPct);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardBody}>
        <Text style={styles.cardWalk}>
          {walkMinutes(distanceM)} {t.walkMinutes}
        </Text>
        <Text style={styles.cardCode} numberOfLines={1}>
          {vehicle.qrCode}
        </Text>
        <View style={styles.cardChips}>
          <Chip
            label={`${String(vehicle.batteryPct)}%`}
            colour={battery}
            background={`${battery}1F`}
          />
          <Chip
            icon="clock"
            label={formatMinutes(rideMinutesLeft(vehicle), lang)}
            colour={colors.textSecondary}
          />
        </View>
      </View>
      {/* The scooter glyph is what makes a card scannable at a glance — the
          reference app leans on a product render for exactly this. */}
      <Icon name="scooter" size={44} color={colors.surfaceMuted} style={styles.cardGlyph} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: EDGE },
  scroller: { width: TRACK_WIDTH },
  track: { paddingLeft: EDGE, paddingRight: spacing.m, gap: spacing.m, alignItems: 'center' },
  card: {
    width: CARD_WIDTH,
    height: 104,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.l,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cardPressed: { backgroundColor: colors.surfaceMuted },
  cardBody: { gap: 3 },
  cardWalk: { ...typography.caption, color: colors.textSecondary, ...numeric },
  cardCode: { fontSize: 19, fontWeight: '800', letterSpacing: -0.4, color: colors.text, ...numeric },
  cardChips: { flexDirection: 'row', gap: spacing.xs + 2, marginTop: spacing.xs },
  // Bleeds off the card's right edge, behind the text.
  cardGlyph: { position: 'absolute', right: -6, bottom: -4, opacity: 0.9 },
  skeleton: { width: CARD_WIDTH, height: 104, borderRadius: radius.l },
  emptyCard: {
    width: CARD_WIDTH,
    height: 104,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.l,
    paddingHorizontal: spacing.l,
    justifyContent: 'center',
    gap: spacing.xs,
  },
  emptyTitle: { ...typography.label, color: colors.text },
  emptyHint: { ...typography.caption, color: colors.textSecondary },
  scanButton: {
    width: SCAN_BUTTON_SIZE,
    height: SCAN_BUTTON_SIZE,
    borderRadius: SCAN_BUTTON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    ...shadows.lg,
  },
  scanLabel: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: colors.textInverse,
  },
});
