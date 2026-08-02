import { Camera, GeoJSONSource, Layer, Map, Marker } from '@maplibre/maplibre-react-native';
import type { CameraRef } from '@maplibre/maplibre-react-native';
import type { LatLon, ParkingCheck } from '@scoot/shared';
import { calculateRideCost, formatSom, isPointInPolygon } from '@scoot/shared';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ApiRequestError } from '@/api/client';
import { useActiveRide, useBeep, useEndRide, usePlans, useZones } from '@/api/queries';
import { ZoneOverlays } from '@/components/ZoneOverlays';
import { Button, Icon, Pill } from '@/components/ui';
import { DEMO_CONTROLS_ENABLED } from '@/lib/demo';
import { formatDistance, formatDuration } from '@/lib/format';
import { polygonCentroid } from '@/lib/geo';
import { useI18n } from '@/lib/i18n';
import { MAP_STYLE_URL, RIDE_ZOOM } from '@/lib/map';
import { DURATION, useCountUp, useMotion } from '@/lib/motion';
import { ZONE_KIND_COLOUR, colors, radius, shadows, spacing, typography } from '@/lib/theme';

const SCREEN_PADDING = 20;

export default function RideScreen() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);
  const { reduced } = useMotion();

  const activeRideQuery = useActiveRide();
  const zonesQuery = useZones();
  const plansQuery = usePlans();
  const endRide = useEndRide();
  const beep = useBeep();

  const [now, setNow] = useState(() => Date.now());
  const [blocked, setBlocked] = useState<ParkingCheck | null>(null);
  // Dev-only stand-in for walking: the simulator moves the scooter along a
  // street route, so "move into a parking zone" (demo step 5) needs a way to
  // place the rider. Mirrors the dev simulate-scan button.
  const [devLocation, setDevLocation] = useState<LatLon | null>(null);
  const [beepNote, setBeepNote] = useState<string | null>(null);

  const ride = activeRideQuery.data?.ride ?? null;
  const zones = zonesQuery.data?.items ?? [];
  const parkingZones = zones.filter((zone) => zone.kind === 'parking');

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Ride ended (or none was active) — nothing to show here. The cache may
  // still hold `{ ride: null }` from before the unlock, so never redirect
  // while a refetch is in flight.
  useEffect(() => {
    if (
      activeRideQuery.data !== undefined &&
      ride === null &&
      !activeRideQuery.isFetching &&
      !endRide.isPending
    ) {
      router.replace('/');
    }
  }, [activeRideQuery.data, activeRideQuery.isFetching, ride, endRide.isPending, router]);

  // Follow the scooter as the simulator moves it.
  const vehicleLat = ride?.vehicle.location.lat;
  const vehicleLon = ride?.vehicle.location.lon;
  useEffect(() => {
    if (vehicleLat === undefined || vehicleLon === undefined) return;
    cameraRef.current?.easeTo({
      center: [vehicleLon, vehicleLat],
      zoom: RIDE_ZOOM,
      duration: 900,
    });
  }, [vehicleLat, vehicleLon]);

  // Frame the rider and the nearest legal zone. Runs as an effect (one frame
  // after the blocked card mounts) because the card shrinks the map — a fit
  // issued from the error callback would be computed against the old height.
  const nearestZone = blocked?.nearestParkingZone ?? null;
  useEffect(() => {
    if (nearestZone === null || ride === null) return;
    const rider = devLocation ?? ride.vehicle.location;
    const centre = polygonCentroid(nearestZone.geom);
    // Grow tiny boxes to the old region clamp so a rider just outside a zone
    // still gets a readable overview, not a max-zoom close-up.
    const MIN_SPAN = 0.006;
    const west = Math.min(rider.lon, centre.lon);
    const south = Math.min(rider.lat, centre.lat);
    const east = Math.max(rider.lon, centre.lon);
    const north = Math.max(rider.lat, centre.lat);
    const lonGrow = Math.max(0, (MIN_SPAN - (east - west)) / 2);
    const latGrow = Math.max(0, (MIN_SPAN - (north - south)) / 2);
    const frame = requestAnimationFrame(() => {
      cameraRef.current?.fitBounds(
        [west - lonGrow, south - latGrow, east + lonGrow, north + latGrow],
        { padding: { top: 80, bottom: 80, left: 60, right: 60 }, duration: 600 },
      );
    });
    return () => cancelAnimationFrame(frame);
    // Deliberately keyed on the blocked zone only: the framing should use the
    // rider position at the moment the end was rejected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearestZone]);

  const plan = plansQuery.data?.items.find((item) => item.id === ride?.planId) ?? null;
  const durationS =
    ride === null ? 0 : Math.max(0, (now - new Date(ride.startedAt).getTime()) / 1000);
  // Same pure function the API charges with — the ticker cannot disagree
  // with the receipt. Fall back to the server's number until plans load.
  const liveCost =
    ride === null
      ? 0
      : plan !== null
        ? calculateRideCost({
            plan: { kind: plan.kind, unlockFee: plan.unlockFee, price: plan.price },
            durationS,
            distanceM: ride.distanceM,
          }).total
        : ride.currentCost;

  // Charged per whole minute, so this jumps rather than creeps — slide it.
  // Computed above the early return below: hooks cannot run conditionally, and
  // this screen legitimately renders with no ride while the poll settles.
  const shownCost = useCountUp(liveCost);

  if (ride === null) {
    return <SafeAreaView style={styles.loading} />;
  }

  // The rider is standing on the scooter — its live position is the ride
  // position, unless the dev control has placed them somewhere specific.
  const riderLocation = devLocation ?? ride.vehicle.location;
  const inParking = parkingZones.some((zone) => isPointInPolygon(riderLocation, zone.geom));

  const submitEnd = (location: LatLon) => {
    endRide.mutate(
      { rideId: ride.id, location },
      {
        onSuccess: async (receipt) => {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.replace({ pathname: '/receipt', params: { rideId: receipt.ride.id } });
        },
        onError: async (error) => {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          if (error instanceof ApiRequestError) {
            const details = error.details as { check?: ParkingCheck } | null;
            if (details?.check !== undefined) {
              // The camera framing happens in the effect above, after the
              // blocked card has mounted and the map has its final size.
              setBlocked(details.check);
              return;
            }
            if (error.code === 'conflict') {
              // Already ended elsewhere — the active-ride poll will redirect.
              return;
            }
          }
        },
      },
    );
  };

  const sendBeep = () => {
    beep.mutate(ride.id, {
      onSuccess: (result) => {
        setBeepNote(result.ok ? t.beepSent : t.beepFailed);
        setTimeout(() => setBeepNote(null), 2500);
      },
      onError: () => {
        setBeepNote(t.beepFailed);
        setTimeout(() => setBeepNote(null), 2500);
      },
    });
  };

  const blockedReasonText =
    blocked?.reason === 'inside_forbidden_zone'
      ? t.insideForbiddenZone
      : blocked?.reason === 'outside_service_area'
        ? t.outsideServiceArea
        : t.outsideParkingZone;
  const nearest = blocked?.nearestParkingZone ?? null;

  return (
    <View style={styles.container}>
      <Map style={styles.map} mapStyle={MAP_STYLE_URL} compass={false}>
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: [ride.vehicle.location.lon, ride.vehicle.location.lat],
            zoom: RIDE_ZOOM,
          }}
        />
        <ZoneOverlays zones={zones} highlightedZoneId={nearest?.id ?? null} />
        {ride.path !== null && ride.path.coordinates.length >= 2 && (
          <GeoJSONSource
            id="ride-path"
            data={{ type: 'Feature', geometry: ride.path, properties: {} }}
          >
            <Layer
              id="ride-path-line"
              type="line"
              paint={{ 'line-color': colors.info, 'line-width': 4 }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
          </GeoJSONSource>
        )}
        <Marker lngLat={[ride.vehicle.location.lon, ride.vehicle.location.lat]}>
          <View style={styles.vehiclePin}>
            <Icon name="scooter" size={22} color={colors.textInverse} />
          </View>
        </Marker>
        {devLocation !== null && (
          <Marker lngLat={[devLocation.lon, devLocation.lat]}>
            <View style={styles.riderPin} />
          </Marker>
        )}
      </Map>

      <View style={[styles.header, { top: insets.top + spacing.s }]}>
        <View style={styles.headerCard}>
          <View style={styles.liveDot} />
          <Text style={styles.headerTitle}>{t.rideTitle}</Text>
          <Text style={styles.headerCode}>{ride.vehicle.qrCode}</Text>
        </View>
        {beepNote !== null && (
          <View style={styles.beepToast}>
            <Text style={styles.beepToastText}>{beepNote}</Text>
          </View>
        )}
      </View>

      <View style={[styles.panel, { paddingBottom: insets.bottom + spacing.l }]}>
        <View style={styles.statsCard}>
          <Stat label={t.duration} value={formatDuration(durationS)} />
          <View style={styles.statDivider} />
          <Stat label={t.distance} value={formatDistance(ride.distanceM, lang)} />
          <View style={styles.statDivider} />
          <Stat label={t.cost} value={formatSom(Math.round(shownCost))} highlight />
        </View>

        <View style={styles.parkingRow}>
          <Pill
            label={inParking ? t.inParkingZone : t.notInParkingZone}
            colour={inParking ? colors.primary : colors.textSecondary}
            faint={inParking ? colors.primaryFaint : colors.surfaceMuted}
          />
          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.beepButton, pressed && styles.beepButtonPressed]}
            onPress={sendBeep}
            disabled={beep.isPending}
          >
            <Icon name="bell" size={16} color={colors.text} />
            <Text style={styles.beepLabel}>{t.beep}</Text>
          </Pressable>
        </View>

        {blocked !== null && (
          <Animated.View
            entering={reduced ? undefined : FadeInDown.duration(DURATION.slow)}
            style={styles.blockedCard}
          >
            <View style={styles.blockedTitleRow}>
              <Icon name="alert" size={20} color={colors.danger} />
              <Text style={styles.blockedTitle}>{t.cantEndHereTitle}</Text>
            </View>
            <Text style={styles.blockedBody}>{blockedReasonText}</Text>
            {nearest !== null && (
              <View style={styles.blockedZoneRow}>
                <Icon name="parking" size={18} color={ZONE_KIND_COLOUR.parking} />
                <Text style={styles.blockedZone}>
                  {t.nearestParking}: {nearest.name} —{' '}
                  {formatDistance(nearest.distanceM, lang)} {t.walkAway}
                </Text>
              </View>
            )}
            <View style={styles.blockedActions}>
              {DEMO_CONTROLS_ENABLED && nearest !== null && (
                <Button
                  label={t.devStepIntoZone}
                  variant="secondary"
                  onPress={() => {
                    setDevLocation(polygonCentroid(nearest.geom));
                    setBlocked(null);
                  }}
                  style={styles.blockedAction}
                />
              )}
              <Button
                label={t.gotIt}
                variant="ghost"
                onPress={() => setBlocked(null)}
                style={styles.blockedAction}
              />
            </View>
          </Animated.View>
        )}

        <Button
          label={endRide.isPending ? t.ending : t.endRide}
          onPress={() => submitEnd(riderLocation)}
          loading={endRide.isPending}
          variant={inParking ? 'primary' : 'danger'}
          testID="end-ride-button"
        />
      </View>
    </View>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      {/* The cost is the widest of the three and grows as the ride runs —
          "6 000 so'm" wrapped onto a second line and broke the row. Shrink to
          fit rather than wrap: the number has to stay one glanceable thing. */}
      <Text
        style={[styles.statValue, highlight && styles.statValueHighlight]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, backgroundColor: colors.background },
  map: { flex: 1 },
  header: { position: 'absolute', left: SCREEN_PADDING, right: SCREEN_PADDING, gap: spacing.s },
  headerCard: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.s,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    ...shadows.md,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  headerTitle: { ...typography.label, color: colors.textSecondary },
  headerCode: { ...typography.label, color: colors.text, fontWeight: '700' },
  beepToast: {
    alignSelf: 'flex-start',
    backgroundColor: colors.text,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
    ...shadows.md,
  },
  beepToastText: { ...typography.label, color: colors.textInverse },
  vehiclePin: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.info,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.surface,
    ...shadows.md,
  },
  riderPin: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.info,
    borderWidth: 3,
    borderColor: colors.surface,
  },
  panel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: SCREEN_PADDING,
    paddingTop: spacing.l,
    gap: spacing.l,
    ...shadows.lg,
  },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.l,
    paddingVertical: spacing.l,
    ...shadows.lg,
  },
  stat: { flex: 1, alignItems: 'center', gap: spacing.xs },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  statLabel: { ...typography.caption, color: colors.textSecondary },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  statValueHighlight: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: colors.primaryPressed,
  },
  parkingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  beepButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.s,
  },
  beepButtonPressed: { backgroundColor: colors.surfaceMuted },
  beepLabel: { ...typography.label, color: colors.text },
  // A refusal, not a hint. The amber card this replaced read like form
  // validation — something to fix and move on from — when the ride genuinely
  // cannot end here. Red, bordered, with the stop icon in the title.
  blockedCard: {
    backgroundColor: colors.dangerFaint,
    borderRadius: radius.l,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: spacing.l,
    gap: spacing.s,
  },
  blockedTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  blockedTitle: { ...typography.heading, color: colors.danger, flex: 1 },
  blockedBody: { ...typography.body, color: colors.textSecondary },
  blockedZoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  blockedZone: { ...typography.body, color: colors.text, fontWeight: '600', flex: 1 },
  blockedActions: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.xs },
  blockedAction: { flex: 1, minHeight: 44 },
});
