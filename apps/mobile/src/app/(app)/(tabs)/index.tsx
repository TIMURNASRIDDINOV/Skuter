import BottomSheet from '@gorhom/bottom-sheet';
import { Camera, Map, UserLocation } from '@maplibre/maplibre-react-native';
import type { CameraRef, ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import type { Vehicle } from '@scoot/shared';
import { formatSom, TASHKENT_MAP_CENTER } from '@scoot/shared';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActiveRide, useVehicles, useZones, usePlans } from '@/api/queries';
import { Icon, IconButton } from '@/components/ui';
import { NearbyList, VehicleDetail } from '@/components/VehicleSheet';
import { VehicleMarkers } from '@/components/VehicleMarkers';
import { ZoneOverlays } from '@/components/ZoneOverlays';
import { formatDuration } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { CITY_ZOOM, FOCUS_ZOOM, INITIAL_BOUNDS, MAP_STYLE_URL } from '@/lib/map';
import { colors, radius, shadows, spacing, typography } from '@/lib/theme';

type Viewport = Pick<ViewStateChangeEvent, 'center' | 'zoom' | 'bounds'>;

const INITIAL_VIEWPORT: Viewport = {
  center: [TASHKENT_MAP_CENTER.lon, TASHKENT_MAP_CENTER.lat],
  zoom: CITY_ZOOM,
  bounds: INITIAL_BOUNDS,
};

const SHEET_PEEK = 148;

export default function MapScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraRef>(null);
  const sheetRef = useRef<BottomSheet>(null);

  const vehiclesQuery = useVehicles();
  const zonesQuery = useZones();
  const plansQuery = usePlans();
  const activeRideQuery = useActiveRide();

  const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const vehicles = vehiclesQuery.data?.items ?? [];
  const zones = zonesQuery.data?.items ?? [];
  const selected = vehicles.find((vehicle) => vehicle.id === selectedId) ?? null;
  const perMinutePlan =
    plansQuery.data?.items.find((plan) => plan.kind === 'per_minute') ?? null;
  const activeRide = activeRideQuery.data?.ride ?? null;

  // A selected vehicle that got unlocked, subscribed or taken offline by
  // someone else vanishes from the public list — drop the stale selection.
  useEffect(() => {
    if (selectedId !== null && selected === null) setSelectedId(null);
  }, [selectedId, selected]);

  useEffect(() => {
    void Location.requestForegroundPermissionsAsync();
  }, []);

  const snapPoints = useMemo(() => [SHEET_PEEK, '52%'], []);

  const selectVehicle = (vehicle: Vehicle) => {
    setSelectedId(vehicle.id);
    sheetRef.current?.snapToIndex(1);
    cameraRef.current?.easeTo({
      center: [vehicle.location.lon, vehicle.location.lat],
      zoom: FOCUS_ZOOM,
      duration: 350,
    });
  };

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
      cameraRef.current?.easeTo({
        center: [position.coords.longitude, position.coords.latitude],
        zoom: FOCUS_ZOOM,
        duration: 350,
      });
    } catch {
      // No fix (simulator without a location set) — the map stays put.
    }
  };

  const showError = vehiclesQuery.isError && vehiclesQuery.data === undefined;

  return (
    <View style={styles.container}>
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
        <ZoneOverlays zones={zones} />
        <VehicleMarkers
          vehicles={vehicles}
          bounds={viewport.bounds}
          zoom={viewport.zoom}
          selectedId={selectedId}
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

      <View style={[styles.topBar, { top: insets.top + spacing.s }]}>
        <IconButton name="locate" onPress={() => void locateMe()} />
      </View>

      {showError && (
        <View style={[styles.errorBanner, { top: insets.top + 64 }]}>
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
          top={insets.top + 64}
          onPress={() => router.push('/ride')}
        />
      )}

      <BottomSheet
        ref={sheetRef}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
        index={0}
        handleIndicatorStyle={styles.sheetHandle}
        backgroundStyle={styles.sheetBackground}
      >
        {selected !== null ? (
          <VehicleDetail
            vehicle={selected}
            perMinutePlan={perMinutePlan}
            onUnlock={() =>
              router.push({ pathname: '/unlock', params: { qr: selected.qrCode } })
            }
            onSubscribe={() =>
              router.push({
                pathname: '/plans',
                params: {
                  vehicleId: selected.id,
                  qr: selected.qrCode,
                  model: selected.model,
                },
              })
            }
            onClose={() => {
              setSelectedId(null);
              sheetRef.current?.snapToIndex(0);
            }}
          />
        ) : (
          <NearbyList
            vehicles={vehicles}
            centre={{ lat: viewport.center[1], lon: viewport.center[0] }}
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            onSelect={selectVehicle}
          />
        )}
      </BottomSheet>
    </View>
  );
}

function ActiveRideBanner({
  startedAt,
  currentCost,
  top,
  onPress,
}: {
  startedAt: string;
  currentCost: number;
  top: number;
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
    <Pressable style={[styles.rideBanner, { top }]} onPress={onPress}>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    position: 'absolute',
    left: SCREEN_EDGE,
    right: SCREEN_EDGE,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  errorBanner: {
    position: 'absolute',
    left: SCREEN_EDGE,
    right: SCREEN_EDGE,
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
    position: 'absolute',
    left: SCREEN_EDGE,
    right: SCREEN_EDGE,
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
    fontVariant: ['tabular-nums'],
  },
  sheetHandle: { backgroundColor: colors.border, width: 44 },
  sheetBackground: { backgroundColor: colors.surface, borderRadius: radius.xl, ...shadows.lg },
});
