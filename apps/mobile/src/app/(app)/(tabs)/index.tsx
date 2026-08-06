import BottomSheet from '@gorhom/bottom-sheet';
import { Camera, Map, UserLocation } from '@maplibre/maplibre-react-native';
import type { CameraRef, ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import type { LatLon, Plan, Vehicle, Zone } from '@scoot/shared';
import { formatSom, haversineDistanceM, TASHKENT_MAP_CENTER } from '@scoot/shared';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useActiveRide,
  usePlans,
  useProfile,
  useReleaseVehicle,
  useReservation,
  useReserveVehicle,
  useVehicles,
  useZones,
} from '@/api/queries';
import { NearbyCarousel } from '@/components/NearbyCarousel';
import { RentSection } from '@/components/RentSection';
import { ReservationBanner } from '@/components/ReservationBanner';
import { SectionPanel, SectionTabs } from '@/components/SectionTabs';
import type { Section } from '@/components/SectionTabs';
import { TariffDetails } from '@/components/TariffPicker';
import { Icon, IconButton, MenuRow } from '@/components/ui';
import { NearbyList, VehicleDetail } from '@/components/VehicleSheet';
import { VehicleMarkers } from '@/components/VehicleMarkers';
import { WalkRoute } from '@/components/WalkRoute';
import { ZoneMarkers } from '@/components/ZoneMarkers';
import { ZoneOverlays } from '@/components/ZoneOverlays';
import { ZoneSheet } from '@/components/ZoneSheet';
import { isRentable, serviceZonesOf } from '@/lib/fleet';
import { formatDuration } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { CITY_ZOOM, FOCUS_ZOOM, INITIAL_BOUNDS, MAP_STYLE_URL } from '@/lib/map';
import { DURATION, EASE_OUT, useMotion } from '@/lib/motion';
import { chrome, colors, numeric, radius, shadows, spacing, typography } from '@/lib/theme';

type Viewport = Pick<ViewStateChangeEvent, 'center' | 'zoom' | 'bounds'>;

const INITIAL_VIEWPORT: Viewport = {
  center: [TASHKENT_MAP_CENTER.lon, TASHKENT_MAP_CENTER.lat],
  zoom: CITY_ZOOM,
  bounds: INITIAL_BOUNDS,
};

/**
 * The resting height of the sheet. Tall enough for the scooter carousel and
 * the scan button, which together are the whole of what the app asks a rider
 * to do on opening.
 */
const SHEET_PEEK = 188;

/** What the sheet is currently showing. */
type SheetMode =
  | { kind: 'nearby' }
  | { kind: 'vehicle'; vehicleId: string }
  | { kind: 'zone'; zone: Zone }
  | { kind: 'tariff'; plan: Plan };

/**
 * Home: the `Общий / Аренда` switcher over the fleet map and the pass list.
 *
 * Both sections stay mounted and are shown by opacity, never by unmounting —
 * tearing MapLibre down and back up on every switch costs a re-init and a
 * re-tile, which reads as the app stalling. Same trick as the mini app's
 * `visibility: hidden` panels.
 */
export default function MapScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const cameraRef = useRef<CameraRef>(null);
  const sheetRef = useRef<BottomSheet>(null);
  const { duration } = useMotion();

  // `/plans` sends the rider back here after buying a pass — land on the
  // section they bought it from, not on the map.
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<Section>(
    params.section === 'rent' ? 'rent' : 'general',
  );
  useEffect(() => {
    if (params.section === undefined) return;
    setSection(params.section === 'rent' ? 'rent' : 'general');
    // Consume it. Left on the route, the param would keep re-selecting that
    // section every time the rider came back to this tab, long after the one
    // purchase that set it.
    router.setParams({ section: undefined });
  }, [params.section, router]);

  const vehiclesQuery = useVehicles();
  const zonesQuery = useZones();
  const plansQuery = usePlans();
  const activeRideQuery = useActiveRide();
  const reservationQuery = useReservation();
  const profileQuery = useProfile();
  const reserve = useReserveVehicle();
  const release = useReleaseVehicle();

  const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT);
  const [mode, setMode] = useState<SheetMode>({ kind: 'nearby' });
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // The device's last known position. `locateMe` used to fetch a fix and throw
  // it away; the walk route needs one that persists.
  const [userLocation, setUserLocation] = useState<LatLon | null>(null);

  const zones = zonesQuery.data?.items ?? [];

  // The rider sees what the back office would not flag red — see
  // docs/parity-review.md §2.1. The API already withholds offline,
  // maintenance, in-use and other riders' reserved scooters; what it cannot
  // know is that a vehicle has drifted outside every service zone, which the
  // panel reports as an alarm and this app would otherwise offer as an
  // ordinary rental.
  const vehicles = useMemo(() => {
    const serviceZones = serviceZonesOf(zones);
    return (vehiclesQuery.data?.items ?? []).filter((vehicle) =>
      isRentable(vehicle, serviceZones),
    );
  }, [vehiclesQuery.data, zones]);

  const plans = plansQuery.data?.items ?? [];
  const perMinutePlan = plans.find((plan) => plan.kind === 'per_minute') ?? null;
  const selectedPlan =
    plans.find((plan) => plan.id === selectedPlanId) ?? perMinutePlan;
  const activeRide = activeRideQuery.data?.ride ?? null;
  const reservation = reservationQuery.data?.reservation ?? null;

  const selected =
    mode.kind === 'vehicle'
      ? (vehicles.find((vehicle) => vehicle.id === mode.vehicleId) ?? null)
      : null;

  // A selected vehicle that got unlocked, subscribed or taken offline by
  // someone else vanishes from the public list — drop the stale selection.
  useEffect(() => {
    if (mode.kind === 'vehicle' && selected === null) setMode({ kind: 'nearby' });
  }, [mode, selected]);

  // Ask once, then keep a fix so the walk route has an origin. A denied
  // permission simply leaves it null and the route never draws.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted || cancelled) return;
      try {
        const position = await Location.getCurrentPositionAsync({});
        if (cancelled) return;
        setUserLocation({ lat: position.coords.latitude, lon: position.coords.longitude });
      } catch {
        // No fix (a simulator with no location set) — the route stays hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Three stops, not two. The detail content is taller than 52% on a short
  // phone and taller than that again at a large font scale, so the sheet needs
  // a stop the rider can drag to that shows all of it at once — and
  // `VehicleDetail` scrolls, so nothing is ever unreachable at any stop.
  const snapPoints = useMemo(() => [SHEET_PEEK, '55%', '92%'], []);

  // The sheet moved on its own defaults while the rest of the app animates on
  // the tokens in lib/motion.ts — same band, same easing, and it collapses to
  // an instant snap when the OS asks for reduced motion.
  const sheetAnimation = useMemo(
    () => ({ duration: duration(DURATION.base), easing: EASE_OUT }),
    [duration],
  );

  const selectVehicle = useCallback((vehicle: Vehicle) => {
    void Haptics.selectionAsync();
    setMode({ kind: 'vehicle', vehicleId: vehicle.id });
    sheetRef.current?.snapToIndex(1);
    cameraRef.current?.easeTo({
      center: [vehicle.location.lon, vehicle.location.lat],
      zoom: FOCUS_ZOOM,
      duration: 350,
    });
  }, []);

  const selectZone = useCallback((zone: Zone) => {
    void Haptics.selectionAsync();
    setMode({ kind: 'zone', zone });
    sheetRef.current?.snapToIndex(1);
  }, []);

  const closeSheet = useCallback(() => {
    setMode({ kind: 'nearby' });
    sheetRef.current?.snapToIndex(0);
  }, []);

  // Demo step 7: pull-to-refresh re-fetches zones as well as vehicles,
  // so a zone drawn on the admin map appears here.
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([vehiclesQuery.refetch(), zonesQuery.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  const locateMe = async () => {
    try {
      const position = await Location.getCurrentPositionAsync({});
      const here = { lat: position.coords.latitude, lon: position.coords.longitude };
      setUserLocation(here);
      cameraRef.current?.easeTo({ center: [here.lon, here.lat], zoom: FOCUS_ZOOM, duration: 350 });
    } catch {
      // No fix (simulator without a location set) — the map stays put.
    }
  };

  const mapCentre = { lat: viewport.center[1], lon: viewport.center[0] };
  // Distances are measured from the rider when we know where they are, and
  // from the map centre otherwise — "3 min walk" from a point the rider is not
  // standing on would be a straightforwardly wrong number.
  const origin = userLocation ?? mapCentre;

  const showError = vehiclesQuery.isError && vehiclesQuery.data === undefined;
  const heldVehicleId = reservation?.vehicle.id ?? null;

  const onExpire = useCallback(() => {
    void reservationQuery.refetch();
    void vehiclesQuery.refetch();
  }, [reservationQuery, vehiclesQuery]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <SectionTabs section={section} onChange={setSection} />

      <View style={styles.sections}>
        <SectionPanel active={section === 'general'}>
          <Map
            style={StyleSheet.absoluteFill}
            mapStyle={MAP_STYLE_URL}
            compass={false}
            // The sheet is permanently docked at SHEET_PEEK — keep the MapLibre
            // logo and the OSM attribution button visible above it.
            logoPosition={{ bottom: SHEET_PEEK + spacing.s, left: spacing.s }}
            attributionPosition={{ bottom: SHEET_PEEK + spacing.s, right: spacing.s }}
            onRegionDidChange={(event) => {
              const { center, zoom, bounds } = event.nativeEvent;
              setViewport({ center, zoom, bounds });
            }}
          >
            <Camera
              ref={cameraRef}
              initialViewState={{ center: INITIAL_VIEWPORT.center, zoom: CITY_ZOOM }}
            />
            <UserLocation />
            <ZoneOverlays
              zones={zones}
              highlightedZoneId={mode.kind === 'zone' ? mode.zone.id : null}
            />
            {selected !== null && <WalkRoute from={userLocation} to={selected.location} />}
            <ZoneMarkers zones={zones} zoom={viewport.zoom} onPress={selectZone} />
            <VehicleMarkers
              vehicles={vehicles}
              bounds={viewport.bounds}
              zoom={viewport.zoom}
              selectedId={selected?.id ?? null}
              onSelectVehicle={selectVehicle}
              onPressCluster={(lat, lon, expansionZoom) => {
                cameraRef.current?.easeTo({
                  center: [lon, lat],
                  zoom: expansionZoom,
                  duration: 350,
                });
              }}
            />
          </Map>

          <View style={styles.topBar}>
            {/* Balance, where the reference app puts it. Reads from /me rather
                than the session copy, so it tracks what rides have cost. */}
            <View style={styles.balanceChip}>
              <Icon name="wallet" size={14} color={chrome.text} />
              <Text style={styles.balanceValue}>
                {profileQuery.data === undefined ? '—' : formatSom(profileQuery.data.balance)}
              </Text>
            </View>
            <IconButton
              name="locate"
              onPress={() => void locateMe()}
              background={chrome.surface}
              color={chrome.text}
              accessibilityLabel={t.showOnMap}
            />
          </View>

          <View style={styles.banners} pointerEvents="box-none">
            {showError && (
              <View style={styles.errorBanner}>
                <Icon name="alert" size={18} color={colors.danger} />
                <Text style={styles.errorText}>{t.loadingError}</Text>
                <Pressable onPress={() => void vehiclesQuery.refetch()}>
                  <Text style={styles.errorRetry}>{t.tryAgain}</Text>
                </Pressable>
              </View>
            )}

            {activeRide !== null && (
              <ActiveRideBanner
                startedAt={activeRide.startedAt}
                currentCost={activeRide.currentCost}
                onPress={() => router.push('/ride')}
              />
            )}

            {activeRide === null && reservation !== null && (
              <ReservationBanner
                vehicle={reservation.vehicle}
                until={reservation.until}
                onPress={() => selectVehicle(reservation.vehicle)}
                onCancel={() => release.mutate(reservation.vehicle.id)}
                onExpire={onExpire}
              />
            )}
          </View>

          <BottomSheet
            ref={sheetRef}
            snapPoints={snapPoints}
            enableDynamicSizing={false}
            index={0}
            animationConfigs={sheetAnimation}
            handleIndicatorStyle={styles.sheetHandle}
            backgroundStyle={styles.sheetBackground}
          >
            {mode.kind === 'vehicle' && selected !== null ? (
              <VehicleDetail
                vehicle={selected}
                plans={plans}
                selectedPlan={selectedPlan}
                distanceM={
                  userLocation === null
                    ? null
                    : haversineDistanceM(userLocation, selected.location)
                }
                held={heldVehicleId === selected.id}
                reserving={reserve.isPending}
                onSelectPlan={(plan) => setSelectedPlanId(plan.id)}
                onShowTariff={() => {
                  if (selectedPlan !== null) setMode({ kind: 'tariff', plan: selectedPlan });
                }}
                onUnlock={() => {
                  if (selectedPlan !== null && selectedPlan.kind !== 'per_minute') {
                    router.push({
                      pathname: '/plans',
                      params: {
                        vehicleId: selected.id,
                        qr: selected.qrCode,
                        model: selected.model,
                        planId: selectedPlan.id,
                      },
                    });
                    return;
                  }
                  router.push({ pathname: '/unlock', params: { qr: selected.qrCode } });
                }}
                onReserve={() => reserve.mutate(selected.id)}
                onClose={closeSheet}
              />
            ) : mode.kind === 'zone' ? (
              <ZoneSheet
                zone={mode.zone}
                onDismiss={closeSheet}
                onMore={() => {
                  closeSheet();
                  router.push('/rules');
                }}
              />
            ) : mode.kind === 'tariff' ? (
              <TariffDetails
                plan={mode.plan}
                onClose={() => {
                  // Back to the scooter this tariff was being read for.
                  const previous = selected ?? null;
                  if (previous === null) closeSheet();
                  else setMode({ kind: 'vehicle', vehicleId: previous.id });
                }}
              />
            ) : (
              <NearbyList
                vehicles={vehicles}
                centre={origin}
                refreshing={refreshing}
                onRefresh={() => void refresh()}
                onSelect={selectVehicle}
                header={
                  <View style={styles.sheetHeader}>
                    <NearbyCarousel
                      vehicles={vehicles}
                      origin={origin}
                      loading={vehiclesQuery.isLoading}
                      onSelect={selectVehicle}
                      onScan={() => router.push('/scan')}
                    />
                    <View style={styles.menu}>
                      <MenuRow
                        icon="parking"
                        label={t.menuRules}
                        onPress={() => router.push('/rules')}
                        testID="menu-rules"
                      />
                      <MenuRow
                        icon="ticket"
                        label={t.menuRent}
                        onPress={() => setSection('rent')}
                      />
                      <MenuRow
                        icon="history"
                        label={t.menuHistory}
                        onPress={() => router.push('/profile')}
                      />
                    </View>
                    <Text style={styles.listTitle}>
                      {t.allScooters} · {vehicles.length}
                    </Text>
                  </View>
                }
              />
            )}
          </BottomSheet>
        </SectionPanel>

        <SectionPanel active={section === 'rent'}>
          <RentSection />
        </SectionPanel>
      </View>
    </SafeAreaView>
  );
}

function ActiveRideBanner({
  startedAt,
  currentCost,
  onPress,
}: {
  startedAt: string;
  currentCost: number;
  onPress: () => void;
}) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsedS = (now - new Date(startedAt).getTime()) / 1000;

  return (
    <Pressable style={styles.rideBanner} onPress={onPress}>
      <View style={styles.rideBannerDot} />
      <Text style={styles.rideBannerText} numberOfLines={1}>
        {t.activeRideBanner} · {formatDuration(elapsedS)}
      </Text>
      <Text style={styles.rideBannerCost}>{formatSom(currentCost)}</Text>
      <Icon name="chevronRight" size={13} color={colors.textInverse} />
    </Pressable>
  );
}

const SCREEN_EDGE = 20;

/** Chrome floating over the map, measured from the top of the map area. */
const MAP_CHROME_TOP = spacing.s;
/** Banners clear the top bar's 44dp control plus a gap. */
const MAP_BANNER_TOP = MAP_CHROME_TOP + 44 + spacing.s;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  sections: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: MAP_CHROME_TOP,
    left: SCREEN_EDGE,
    right: SCREEN_EDGE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.s,
  },
  balanceChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    backgroundColor: chrome.surface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.m,
    height: 36,
    ...shadows.md,
  },
  balanceValue: { fontSize: 14, fontWeight: '700', color: chrome.text, ...numeric },
  banners: {
    position: 'absolute',
    top: MAP_BANNER_TOP,
    left: SCREEN_EDGE,
    right: SCREEN_EDGE,
    gap: spacing.s,
  },
  errorBanner: {
    backgroundColor: colors.dangerFaint,
    borderRadius: radius.m,
    padding: spacing.m,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    ...shadows.md,
  },
  errorText: { ...typography.label, color: colors.danger, flex: 1 },
  errorRetry: { ...typography.label, color: colors.danger, textDecorationLine: 'underline' },
  rideBanner: {
    backgroundColor: colors.text,
    borderRadius: radius.full,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    ...shadows.lg,
  },
  rideBannerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  rideBannerText: { ...typography.label, color: colors.textInverse, flex: 1 },
  rideBannerCost: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    color: colors.textInverse,
    ...numeric,
  },
  sheetHeader: { paddingTop: spacing.xs, gap: spacing.l },
  menu: { paddingHorizontal: spacing.xs },
  listTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: SCREEN_EDGE,
    paddingTop: spacing.s,
  },
  sheetHandle: { backgroundColor: colors.border, width: 44 },
  sheetBackground: { backgroundColor: colors.surface, borderRadius: radius.xl, ...shadows.lg },
});
