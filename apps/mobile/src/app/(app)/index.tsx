import BottomSheet from '@gorhom/bottom-sheet';
import { Camera, Map, UserLocation } from '@maplibre/maplibre-react-native';
import type { CameraRef, ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import type { LatLon, Plan, Vehicle, Zone } from '@ozothunder/shared';
import { formatSom, haversineDistanceM, BUKHARA_MAP_CENTER } from '@ozothunder/shared';
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
  useProfile,
  useReleaseVehicle,
  useRental,
  useReservation,
  useReserveVehicle,
  useVehicles,
  useZones,
} from '@/api/queries';
import { MenuSheet } from '@/components/MenuSheet';
import { ModeSwitch } from '@/components/ModeSwitch';
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
import { useRentalMode } from '@/lib/rental-mode';
import { CITY_ZOOM, FOCUS_ZOOM, INITIAL_BOUNDS, MAP_STYLE_URL } from '@/lib/map';
import { DURATION, EASE_OUT, useMotion } from '@/lib/motion';
import {
  caps,
  colors,
  numeric,
  outline,
  outlineHair,
  radius,
  shadows,
  spacing,
} from '@/lib/theme';

type Viewport = Pick<ViewStateChangeEvent, 'center' | 'zoom' | 'bounds'>;

const INITIAL_VIEWPORT: Viewport = {
  center: [BUKHARA_MAP_CENTER.lon, BUKHARA_MAP_CENTER.lat],
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
  const profileQuery = useProfile();
  const rentalQuery = useRental();
  const { mode: rentalMode, setMode: setRentalMode, ready: modeReady } = useRentalMode();
  const reserve = useReserveVehicle();
  const release = useReleaseVehicle();

  const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT);
  const [mode, setMode] = useState<SheetMode | null>(null);
  // Zones are drawn by default — a rider who does not know the rules is
  // exactly the one who needs to see them. The toggle is for the other case:
  // four overlapping polygons over the pin you are trying to tap.
  const [showZones, setShowZones] = useState(true);
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

  const rental = rentalQuery.data?.rental ?? null;

  /**
   * Crossing into the rental — on launch, and when the switch is pressed.
   *
   * One effect drives both: pressing the switch only writes the preference,
   * and this is what acts on it. That is also why a rider who left the app in
   * rental mode reopens into it — a rental genuinely replaces the app for its
   * window rather than being a screen to find again.
   *
   * `replace`, not `push`: the two faces are alternatives, not a stack, so
   * there is no map sitting behind the rental to swipe back to. Both
   * conditions matter — a stored preference is meaningless once the rental
   * ends, and acting before SecureStore has answered would bounce every
   * launch through the map.
   */
  useEffect(() => {
    if (modeReady && rentalMode === 'rental' && rental !== null) router.replace('/rental');
  }, [modeReady, rentalMode, rental, router]);

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
        {showZones && (
          <ZoneOverlays
            zones={zones}
            highlightedZoneId={mode?.kind === 'zone' ? mode.zone.id : null}
          />
        )}
        {selected !== null && <WalkRoute from={userLocation} to={selected.location} />}
        {showZones && <ZoneMarkers zones={zones} zoom={viewport.zoom} onPress={selectZone} />}
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

      <View style={[styles.chrome, { top: chromeTop }]} pointerEvents="box-none">
        {/* The brand mark, what a ride will cost against, and the zones
            switch. All three were previously either absent or two taps deep
            behind ☰ — and the balance in particular is the one fact a rider
            wants *before* walking to a scooter, not after failing to unlock
            one. */}
        <View style={styles.topBar}>
          {/* The mark, or the way into the rental — never both. A rider
              with a weekly agreement has somewhere else to be, and this is the
              corner their eye already goes to; a rider without one sees the
              brand exactly as before. */}
          {rental === null ? (
            <View style={styles.brand}>
              <View style={styles.brandMark}>
                <Icon name="scooter" size={16} color={colors.onPrimary} />
              </View>
            </View>
          ) : (
            <ModeSwitch
              target="rental"
              onPress={() => {
                setRentalMode('rental');
              }}
            />
          )}

          <View style={styles.topActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.balance}
              testID="balance-pill"
              onPress={() => openSheet({ kind: 'menu' })}
              style={({ pressed }) => [styles.balance, pressed && styles.chromePressed]}
            >
              <Icon name="wallet" size={15} color={colors.text} />
              <Text style={styles.balanceValue} numberOfLines={1}>
                {profileQuery.data === undefined ? '—' : formatSom(profileQuery.data.balance)}
              </Text>
            </Pressable>

            <IconButton
              name="layers"
              size={40}
              onPress={() => setShowZones((on) => !on)}
              background={showZones ? colors.primary : colors.surface}
              accessibilityLabel={t.toggleZones}
              testID="zones-toggle"
            />
          </View>
        </View>

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
          <Icon name="scan" size={30} color={colors.onPrimary} />
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
    // Label, clock, cost — in that order of expendability. The label is the
    // only flexible child, so when Uzbek's «Safar davom etmoqda» outgrows the
    // pill it is the *word* that ellipsises; the two numbers the rider is
    // actually watching are never the thing that gets cut.
    <Pressable style={styles.rideBanner} onPress={onPress}>
      <View style={styles.rideBannerDot} />
      <Text style={styles.rideBannerText} numberOfLines={1}>
        {t.activeRideBanner}
      </Text>
      <Text style={styles.rideBannerTime}>{formatDuration(elapsedS)}</Text>
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
    ...outline,
    ...shadows.lg,
  },
  chrome: {
    position: 'absolute',
    left: SCREEN_EDGE,
    right: SCREEN_EDGE,
    gap: spacing.s,
  },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // The mark alone, so the pill is a circle rather than a wordmark-shaped
  // stub with nothing in it.
  brand: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    padding: 5,
    ...outline,
    ...shadows.md,
  },
  brandMark: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...outlineHair,
  },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.s },
  balance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s + 2,
    ...outline,
    ...shadows.md,
  },
  balanceValue: { fontSize: 13, fontWeight: '900', color: colors.text, ...numeric },
  chromePressed: {
    transform: [{ translateY: 2 }],
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  errorBanner: {
    backgroundColor: colors.dangerFaint,
    borderRadius: radius.m,
    padding: spacing.m,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    ...outline,
    ...shadows.md,
  },
  // Tightened for the same reason as `rideBannerText`: a sentence-length
  // string sharing one row with an icon and a retry link.
  errorText: { ...caps, fontSize: 12, letterSpacing: 0.2, color: colors.text, flex: 1 },
  errorRetry: {
    ...caps,
    fontSize: 12,
    letterSpacing: 0.2,
    color: colors.text,
    textDecorationLine: 'underline',
  },
  rideBanner: {
    backgroundColor: colors.ink,
    borderRadius: radius.full,
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s,
    ...outline,
    ...shadows.lg,
  },
  rideBannerDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  // Tighter than the `caps` default on both counts — three things share this
  // pill and the tracking is what pushed it over the edge.
  rideBannerText: {
    ...caps,
    fontSize: 11,
    letterSpacing: 0.2,
    color: 'rgba(255,255,255,0.76)',
    flex: 1,
  },
  rideBannerTime: {
    fontSize: 13,
    fontWeight: '900',
    color: colors.textInverse,
    flexShrink: 0,
    ...numeric,
  },
  rideBannerCost: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.2,
    color: colors.primary,
    flexShrink: 0,
    ...numeric,
  },
  listTitle: {
    fontSize: 12,
    ...caps,
    color: colors.textSecondary,
    paddingHorizontal: SCREEN_EDGE,
    paddingBottom: spacing.s,
  },
  sheetHandle: { backgroundColor: colors.text, width: 48, height: 5 },
  sheetBackground: {
    backgroundColor: colors.background,
    borderRadius: radius.xl,
    borderWidth: 2,
    borderColor: colors.border,
    ...shadows.sheet,
  },
});
