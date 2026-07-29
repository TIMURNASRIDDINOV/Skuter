import { Marker } from '@maplibre/maplibre-react-native';
import type { LngLatBounds } from '@maplibre/maplibre-react-native';
import type { Vehicle } from '@scoot/shared';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Supercluster from 'supercluster';
import { Icon } from '@/components/ui';
import { colors, shadows, VEHICLE_STATUS_COLOUR } from '@/lib/theme';

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
        const selected = vehicle.id === selectedId;
        const statusColour = VEHICLE_STATUS_COLOUR[vehicle.status];
        return (
          <Marker
            key={vehicle.id}
            lngLat={[vehicle.location.lon, vehicle.location.lat]}
            onPress={() => onSelectVehicle(vehicle)}
          >
            <View
              style={[
                styles.pin,
                { borderColor: statusColour },
                selected && styles.pinSelected,
              ]}
            >
              <Icon name="scooter" size={18} color={statusColour} />
            </View>
          </Marker>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
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
  pinSelected: {
    transform: [{ scale: 1.2 }],
    borderColor: colors.text,
  },
});
