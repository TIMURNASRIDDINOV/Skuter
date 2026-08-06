import { Marker } from '@maplibre/maplibre-react-native';
import type { LngLatBounds } from '@maplibre/maplibre-react-native';
import type { LatLon, Vehicle } from '@scoot/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Supercluster from 'supercluster';
import { Icon } from '@/components/ui';
import { needsAttention } from '@/lib/fleet';
import { DURATION, useMotion } from '@/lib/motion';
import { colors, shadows, spacing, VEHICLE_STATUS_COLOUR } from '@/lib/theme';

interface VehicleMarkersProps {
  vehicles: Vehicle[];
  /** Current viewport, as reported by the map — already [w, s, e, n]. */
  bounds: LngLatBounds;
  zoom: number;
  selectedId: string | null;
  onSelectVehicle: (vehicle: Vehicle) => void;
  onPressCluster: (lat: number, lon: number, expansionZoom: number) => void;
}

type VehicleFeature = Supercluster.PointFeature<{ vehicle: Vehicle }>;

/**
 * Clustered scooter pins. 70 vehicles recluster in well under a millisecond,
 * so the index is simply rebuilt whenever the fleet changes.
 */
export function VehicleMarkers({
  vehicles,
  bounds,
  zoom,
  selectedId,
  onSelectVehicle,
  onPressCluster,
}: VehicleMarkersProps) {
  const index = useMemo(() => {
    const features: VehicleFeature[] = vehicles.map((vehicle) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [vehicle.location.lon, vehicle.location.lat] },
      properties: { vehicle },
    }));
    const cluster = new Supercluster<{ vehicle: Vehicle }>({ radius: 52, maxZoom: 17 });
    cluster.load(features);
    return cluster;
  }, [vehicles]);

  const clusters = useMemo(
    () => index.getClusters([...bounds], Math.round(zoom)),
    [index, bounds, zoom],
  );

  return (
    <>
      {clusters.map((feature) => {
        const [lon, lat] = feature.geometry.coordinates;
        if (lon === undefined || lat === undefined) return null;

        if (feature.properties !== null && 'cluster' in feature.properties) {
          const clusterId = feature.properties.cluster_id;
          const count = feature.properties.point_count;
          return (
            <Marker
              key={`cluster-${clusterId}`}
              lngLat={[lon, lat]}
              onPress={() =>
                onPressCluster(lat, lon, Math.min(index.getClusterExpansionZoom(clusterId), 18))
              }
            >
              <View style={styles.cluster}>
                <Text style={styles.clusterCount}>{count}</Text>
              </View>
            </Marker>
          );
        }

        const vehicle = feature.properties.vehicle;
        return (
          <VehicleMarker
            key={vehicle.id}
            vehicle={vehicle}
            selected={vehicle.id === selectedId}
            onPress={onSelectVehicle}
          />
        );
      })}
    </>
  );
}

/**
 * One scooter, gliding to its new position instead of teleporting.
 *
 * The fleet polls every 5 s and each vehicle jumps to wherever it now is. The
 * move is interpolated over 250 ms — deliberately *not* stretched across the
 * whole poll interval, which would smooth the telemetry into a lie about where
 * a scooter actually is. It is a short catch-up, not a simulation of travel.
 *
 * State lives per marker so a moving scooter re-renders only itself, and only
 * individual pins animate: clusters recompute their centroid as membership
 * changes, so interpolating those would animate a number, not a vehicle.
 */
function VehicleMarker({
  vehicle,
  selected,
  onPress,
}: {
  vehicle: Vehicle;
  selected: boolean;
  onPress: (vehicle: Vehicle) => void;
}) {
  const { duration } = useMotion();
  const position = useGlidingPosition(vehicle.location, duration(DURATION.slow));
  const statusColour = VEHICLE_STATUS_COLOUR[vehicle.status];
  const attention = needsAttention(vehicle);

  // `typeof` rather than `!== null`: a payload that predates the reservation
  // columns leaves the field `undefined`, which is not null and would have
  // put a padlock on every scooter on the map.
  const held = typeof vehicle.reservedUntil === 'string';

  // The selected pin becomes a teardrop bubble — bigger, white-filled, with a
  // stem pointing at the actual coordinate. A pin that only scales up is easy
  // to lose among its neighbours; one that changes silhouette is not, and the
  // stem keeps the position unambiguous at the larger size.
  if (selected) {
    return (
      <Marker lngLat={[position.lon, position.lat]} onPress={() => onPress(vehicle)}>
        <View style={styles.bubbleWrap}>
          <View style={[styles.bubble, { borderColor: held ? colors.primary : statusColour }]}>
            <Icon name="scooter" size={26} color={held ? colors.primary : statusColour} />
          </View>
          <View
            style={[styles.bubbleStem, { borderTopColor: held ? colors.primary : statusColour }]}
          />
        </View>
      </Marker>
    );
  }

  return (
    <Marker lngLat={[position.lon, position.lat]} onPress={() => onPress(vehicle)}>
      <View style={styles.pinWrap}>
        <View style={[styles.pin, { borderColor: held ? colors.primary : statusColour }]}>
          <Icon name="scooter" size={18} color={held ? colors.primary : statusColour} />
        </View>
        {/* A held scooter is the rider's own — the only one on their map with
            a lock on it, so the badge says which without needing the sheet. */}
        {held && (
          <View style={styles.holdBadge}>
            <Icon name="lock" size={9} color={colors.textInverse} />
          </View>
        )}
        {/* Colour alone would carry this; the badge states it, which survives
            a colour-blind viewer and a sunlit phone. */}
        {attention && !held && (
          <View style={styles.batteryBadge}>
            <Text style={styles.batteryBadgeText}>{vehicle.batteryPct}%</Text>
          </View>
        )}
      </View>
    </Marker>
  );
}

function useGlidingPosition(target: LatLon, durationMs: number): LatLon {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const origin = from.current;
    const deltaLat = target.lat - origin.lat;
    const deltaLon = target.lon - origin.lon;

    if (durationMs === 0 || (deltaLat === 0 && deltaLon === 0)) {
      from.current = target;
      setShown(target);
      return;
    }

    const start = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / durationMs);
      const eased = 1 - (1 - t) ** 3;
      setShown({ lat: origin.lat + deltaLat * eased, lon: origin.lon + deltaLon * eased });
      if (t < 1) {
        frame.current = requestAnimationFrame(step);
      } else {
        from.current = target;
        frame.current = null;
      }
    };
    frame.current = requestAnimationFrame(step);

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      // Land on the target so an interrupted glide never strands the pin
      // between two real positions.
      from.current = target;
    };
  }, [target.lat, target.lon, durationMs]);

  return shown;
}

const styles = StyleSheet.create({
  pinWrap: { alignItems: 'center' },
  bubbleWrap: { alignItems: 'center' },
  bubble: {
    width: 54,
    height: 54,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 3,
    ...shadows.lg,
  },
  // A CSS-triangle stem: a zero-size box with only its top border drawn.
  bubbleStem: {
    width: 0,
    height: 0,
    marginTop: -2,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  holdBadge: {
    marginTop: -6,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  batteryBadge: {
    marginTop: -6,
    paddingHorizontal: spacing.xs + 1,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: VEHICLE_STATUS_COLOUR.low_battery,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  batteryBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textInverse,
    fontVariant: ['tabular-nums'],
  },
  cluster: {
    minWidth: 40,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 6,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: colors.surface,
    ...shadows.md,
  },
  clusterCount: { color: colors.textInverse, fontSize: 14, fontWeight: '700' },
  pin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 3,
    ...shadows.md,
  },
});
