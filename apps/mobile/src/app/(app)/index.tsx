import BottomSheet from '@gorhom/bottom-sheet';
import { Camera, Map, UserLocation } from '@maplibre/maplibre-react-native';
import type { CameraRef, ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import type { LatLon, Plan, Vehicle, Zone } from '@scoot/shared';
import { formatSom, haversineDistanceM, TASHKENT_MAP_CENTER } from '@scoot/shared';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useActiveRide,
  usePlans,
  useReleaseVehicle,
  useReservation,
  useReserveVehicle,
  useVehicles,
  useZones,
} from '@/api/queries';
import { MenuSheet } from '@/components/MenuSheet';
import { ReservationBanner } from '@/components/ReservationBanner';
import { TariffDetails } from '@/components/TariffPicker';
import { Icon, IconButton } from '@/components/ui';
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
import { colors, numeric, radius, shadows, spacing, typography } from '@/lib/theme';

type Viewport = Pick<ViewStateChangeEvent, 'center' | 'zoom' | 'bounds'>;

const INITIAL_VIEWPORT: Viewport = {
  center: [TASHKENT_MAP_CENTER.lon, TASHKENT_MAP_CENTER.lat],
  zoom: CITY_ZOOM,
  bounds: INITIAL_BOUNDS,
};

/**
 * What the sheet is showing, or `null` for closed.
 *
 * The sheet has no resting height any more — the map is bare until the rider
 * asks for something, so "closed" is a state of this union rather than a snap
 * point the sheet sits at.
 */
type SheetMode =
  | { kind: 'menu' }
  | { kind: 'nearby' }
  | { kind: 'vehicle'; vehicleId: string }
  | { kind: 'zone'; zone: Zone }
  | { kind: 'tariff'; plan: Plan };

/** Routes the menu sheet can push. */
type MenuHref = '/profile' | '/rent' | '/history' | '/rules';

/**
 * Home: the fleet map, and nothing else.
 *
 * Full bleed under the status bar, with one floating row of controls at the
 * bottom — ☰, scan, locate — and no tab bar, no section switcher and no docked
 * sheet. Every other screen in the app is pushed from the ☰ sheet, which makes
 * this the app's only root and the map the thing it is always showing.
 */
export default function MapScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const cameraRef = useRef<CameraRef>(null);
  const sheetRef = useRef<BottomSheet>(null);
  const { duration } = useMotion();
  const insets = useSafeAreaInsets();

  const vehiclesQuery = useVehicles();
  const zonesQuery = useZones();
  const plansQuery = usePlans();
  const activeRideQuery = useActiveRide();
  const reservationQuery = useReservation();
  const reserve = useReserveVehicle();
  const release = useReleaseVehicle();

  const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT);
  const [mode, setMode] = useState<SheetMode | null>(null);
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
    mode?.kind === 'vehicle'
      ? (vehicles.find((vehicle) => vehicle.id === mode.vehicleId) ?? null)
      : null;

  const closeSheet = useCallback(() => {
    setMode(null);
    sheetRef.current?.close();
  }, []);

  // A selected vehicle that got unlocked, subscribed or taken offline by
  // someone else vanishes from the public list — drop the stale selection.
  useEffect(() => {
    if (mode?.kind === 'vehicle' && selected === null) closeSheet();
  }, [mode, selected, closeSheet]);

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

  // Two stops. The detail content is taller than 55% on a short phone and
  // taller again at a large font scale, so the sheet needs a stop that shows
  // all of it at once — and `VehicleDetail` scrolls, so nothing is ever
  // unreachable at either. The top stop is 100% of the sheet's own container,
  // which `chromeTop` below has already cut short of the status bar.
  const snapPoints = useMemo(() => ['55%', '100%'], []);

  // The map is full bleed, so the sheet's container is the whole screen and a
  // fully open sheet would slide under the status bar. Passed as the sheet's
  // `topInset`, every percentage snap point resolves against what is left — so
  // "100%" means "as far up as it may go", not "over the clock".
  const chromeTop = insets.top + spacing.s;

  // The sheet moved on its own defaults while the rest of the app animates on
  // the tokens in lib/motion.ts — same band, same easing, and it collapses to
  // an instant snap when the OS asks for reduced motion.
  const sheetAnimation = useMemo(
    () => ({ duration: duration(DURATION.base), easing: EASE_OUT }),
    [duration],
  );

  const openSheet = useCallback((next: SheetMode, index = 0) => {
    setMode(next);
    sheetRef.current?.snapToIndex(index);
  }, []);

  const selectVehicle = useCallback(
    (vehicle: Vehicle) => {
      void Haptics.selectionAsync();
      openSheet({ kind: 'vehicle', vehicleId: vehicle.id });
      cameraRef.current?.easeTo({
        center: [vehicle.location.lon, vehicle.location.lat],
        zoom: FOCUS_ZOOM,
        duration: 350,
      });
    },
    [openSheet],
  );

  const selectZone = useCallback(
    (zone: Zone) => {
      void Haptics.selectionAsync();
      openSheet({ kind: 'zone', zone });
    },
    [openSheet],
  );

  // Push from the menu only after the sheet is out of the way — a route that
  // opens behind an open sheet is still there when the rider comes back.
  const navigateFromMenu = useCallback(
    (href: MenuHref) => {
      closeSheet();
      router.push(href as Href);
    },
    [closeSheet, router],
  );

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

  // The floating row's own height plus its inset, so the MapLibre logo and the
  // OSM attribution clear it.
  const barClearance = insets.bottom + spacing.m + SCAN_SIZE + spacing.s;

  return (
    <View style={styles.container}>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE_URL}
        compass={false}
        // Both on the left: the right of that strip belongs to the locate
        // button, and the centre to the scan control.
        logoPosition={{ bottom: barClearance, left: spacing.s }}
        attributionPosition={{ bottom: barClearance, left: 100 }}
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
          highlightedZoneId={mode?.kind === 'zone' ? mode.zone.id : null}
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

      <View style={[styles.banners, { top: chromeTop }]} pointerEvents="box-none">
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

      {/* The whole of the app's chrome: everything else is behind ☰. Scanning
          is the centre and the largest, because it is the one thing a rider
          standing next to a scooter came here to do. */}
      <View style={[styles.bar, { bottom: insets.bottom + spacing.m }]} pointerEvents="box-none">
        <IconButton
          name="menu"
          onPress={() => openSheet({ kind: 'menu' })}
          size={SIDE_SIZE}
          accessibilityLabel={t.menuTitle}
          testID="menu-button"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.scan}
          testID="scan-button"
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push('/scan');
          }}
          style={({ pressed }) => [
            styles.scanButton,
            { backgroundColor: pressed ? colors.primaryPressed : colors.primary },
          ]}
        >
          <Icon name="scan" size={30} color={colors.textInverse} />
        </Pressable>
        <IconButton
          name="locate"
          onPress={() => void locateMe()}
          size={SIDE_SIZE}
          accessibilityLabel={t.showOnMap}
        />
      </View>

      <BottomSheet
        ref={sheetRef}
        snapPoints={snapPoints}
        topInset={chromeTop}
        enableDynamicSizing={false}
        // Closed at rest, and a drag down returns to the bare map rather than
        // to a peek there is no longer any such thing as.
        index={-1}
        enablePanDownToClose
        onClose={() => setMode(null)}
        animationConfigs={sheetAnimation}
        handleIndicatorStyle={styles.sheetHandle}
        backgroundStyle={styles.sheetBackground}
      >
        {mode?.kind === 'vehicle' && selected !== null ? (
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
        ) : mode?.kind === 'zone' ? (
          <ZoneSheet
            zone={mode.zone}
            onDismiss={closeSheet}
            onMore={() => navigateFromMenu('/rules')}
          />
        ) : mode?.kind === 'tariff' ? (
          <TariffDetails
            plan={mode.plan}
            onClose={() => {
              // Back to the scooter this tariff was being read for.
              const previous = selected ?? null;
              if (previous === null) closeSheet();
              else setMode({ kind: 'vehicle', vehicleId: previous.id });
            }}
          />
        ) : mode?.kind === 'nearby' ? (
          <NearbyList
            vehicles={vehicles}
            centre={origin}
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            onSelect={selectVehicle}
            header={
              <Text style={styles.listTitle}>
                {t.allScooters} · {vehicles.length}
              </Text>
            }
          />
        ) : (
          <MenuSheet onShowNearby={() => setMode({ kind: 'nearby' })} onNavigate={navigateFromMenu} />
        )}
      </BottomSheet>
    </View>
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

/** The floating row: two 52dp circles either side of a 72dp scan control. */
const SIDE_SIZE = 52;
const SCAN_SIZE = 72;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  bar: {
    position: 'absolute',
    left: SCREEN_EDGE,
    right: SCREEN_EDGE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scanButton: {
    width: SCAN_SIZE,
    height: SCAN_SIZE,
    borderRadius: SCAN_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.lg,
  },
  banners: {
    position: 'absolute',
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
  listTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: SCREEN_EDGE,
    paddingBottom: spacing.s,
  },
  // `border` on `surface` is a 4dp bar at roughly 4% contrast — invisible.
  sheetHandle: { backgroundColor: colors.textTertiary, width: 44 },
  sheetBackground: { backgroundColor: colors.surface, borderRadius: radius.xl, ...shadows.lg },
});
