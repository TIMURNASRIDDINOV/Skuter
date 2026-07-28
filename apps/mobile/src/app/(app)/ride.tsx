import type { LatLon, ParkingCheck } from '@scoot/shared';
import { calculateRideCost, formatSom } from '@scoot/shared';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiRequestError } from '@/api/client';
import { useActiveRide, useBeep, useEndRide, usePlans, useZones } from '@/api/queries';
import { ZoneOverlays } from '@/components/ZoneOverlays';
import { Button, Pill } from '@/components/ui';
import { DEMO_CONTROLS_ENABLED } from '@/lib/demo';
import { formatDistance, formatDuration } from '@/lib/format';
import { pointInPolygon, polygonCentroid } from '@/lib/geo';
import { useI18n } from '@/lib/i18n';
import { colors, radius, spacing, typography } from '@/lib/theme';

export default function RideScreen() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

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
    mapRef.current?.animateToRegion(
      { latitude: vehicleLat, longitude: vehicleLon, latitudeDelta: 0.008, longitudeDelta: 0.008 },
      900,
    );
  }, [vehicleLat, vehicleLon]);

  if (ride === null) {
    return <SafeAreaView style={styles.loading} />;
  }

  // The rider is standing on the scooter — its live position is the ride
  // position, unless the dev control has placed them somewhere specific.
  const riderLocation = devLocation ?? ride.vehicle.location;
  const inParking = parkingZones.some((zone) => pointInPolygon(riderLocation, zone.geom));

  const plan = plansQuery.data?.items.find((item) => item.id === ride.planId) ?? null;
  const durationS = Math.max(0, (now - new Date(ride.startedAt).getTime()) / 1000);
  // Same pure function the API charges with — the ticker cannot disagree
  // with the receipt. Fall back to the server's number until plans load.
  const liveCost =
    plan !== null
      ? calculateRideCost({
          plan: { kind: plan.kind, unlockFee: plan.unlockFee, price: plan.price },
          durationS,
          distanceM: ride.distanceM,
        }).total
      : ride.currentCost;

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
              setBlocked(details.check);
              const nearest = details.check.nearestParkingZone;
              if (nearest !== null) {
                const centre = polygonCentroid(nearest.geom);
                mapRef.current?.animateToRegion(
                  {
                    latitude: (riderLocation.lat + centre.lat) / 2,
                    longitude: (riderLocation.lon + centre.lon) / 2,
                    latitudeDelta: Math.max(Math.abs(riderLocation.lat - centre.lat) * 2.8, 0.006),
                    longitudeDelta: Math.max(Math.abs(riderLocation.lon - centre.lon) * 2.8, 0.006),
                  },
                  600,
                );
              }
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
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: ride.vehicle.location.lat,
          longitude: ride.vehicle.location.lon,
          latitudeDelta: 0.008,
          longitudeDelta: 0.008,
        }}
        showsCompass={false}
        toolbarEnabled={false}
      >
        <ZoneOverlays zones={zones} highlightedZoneId={nearest?.id ?? null} />
        {ride.path !== null && ride.path.coordinates.length >= 2 && (
          <Polyline
            coordinates={ride.path.coordinates.map(([lon, lat]) => ({
              latitude: lat,
              longitude: lon,
            }))}
            strokeColor={colors.info}
            strokeWidth={4}
          />
        )}
        <Marker
          coordinate={{
            latitude: ride.vehicle.location.lat,
            longitude: ride.vehicle.location.lon,
          }}
          anchor={{ x: 0.5, y: 0.5 }}
        >
          <View style={styles.vehiclePin}>
            <Text style={styles.vehiclePinGlyph}>🛴</Text>
          </View>
        </Marker>
        {devLocation !== null && (
          <Marker
            coordinate={{ latitude: devLocation.lat, longitude: devLocation.lon }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.riderPin} />
          </Marker>
        )}
      </MapView>

      <View style={[styles.header, { top: insets.top + spacing.s }]}>
        <View style={styles.headerCard}>
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
        <View style={styles.statsRow}>
          <Stat label={t.duration} value={formatDuration(durationS)} />
          <Stat label={t.distance} value={formatDistance(ride.distanceM, lang)} />
          <Stat label={t.cost} value={formatSom(liveCost)} highlight />
        </View>

        <View style={styles.parkingRow}>
          <Pill
            label={inParking ? t.inParkingZone : t.notInParkingZone}
            colour={inParking ? colors.primary : colors.textSecondary}
            faint={inParking ? colors.primaryFaint : colors.surfaceMuted}
          />
          <Pressable style={styles.beepButton} onPress={sendBeep} disabled={beep.isPending}>
            <Text style={styles.beepLabel}>🔔 {t.beep}</Text>
          </Pressable>
        </View>

        {blocked !== null && (
          <View style={styles.blockedCard}>
            <Text style={styles.blockedTitle}>{t.cantEndHereTitle}</Text>
            <Text style={styles.blockedBody}>{blockedReasonText}</Text>
            {nearest !== null && (
              <Text style={styles.blockedZone}>
                {t.nearestParking}: {nearest.name} —{' '}
                {formatDistance(nearest.distanceM, lang)} {t.walkAway}
              </Text>
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
          </View>
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
      <Text style={[styles.statValue, highlight && { color: colors.primaryPressed }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, backgroundColor: colors.background },
  map: { flex: 1 },
  header: { position: 'absolute', left: spacing.l, right: spacing.l, gap: spacing.s },
  headerCard: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.s,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  headerTitle: { ...typography.label, color: colors.textSecondary },
  headerCode: { ...typography.label, color: colors.text, fontWeight: '700' },
  beepToast: {
    alignSelf: 'flex-start',
    backgroundColor: colors.text,
    borderRadius: radius.m,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s,
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
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  vehiclePinGlyph: { fontSize: 20 },
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
    padding: spacing.l,
    gap: spacing.l,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
  },
  statsRow: { flexDirection: 'row', gap: spacing.m },
  stat: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.m,
    padding: spacing.m,
    gap: 2,
  },
  statLabel: { ...typography.caption, color: colors.textSecondary },
  statValue: { ...typography.heading, color: colors.text, fontVariant: ['tabular-nums'] },
  parkingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  beepButton: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.s,
  },
  beepLabel: { ...typography.label, color: colors.text },
  blockedCard: {
    backgroundColor: colors.warningFaint,
    borderRadius: radius.l,
    padding: spacing.l,
    gap: spacing.s,
  },
  blockedTitle: { ...typography.heading, color: colors.text },
  blockedBody: { ...typography.body, color: colors.textSecondary },
  blockedZone: { ...typography.body, color: colors.text, fontWeight: '600' },
  blockedActions: { flexDirection: 'row', gap: spacing.s, marginTop: spacing.xs },
  blockedAction: { flex: 1, minHeight: 44 },
});
