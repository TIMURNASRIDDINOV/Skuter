import type { Vehicle } from '@scoot/shared';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import type { Region } from 'react-native-maps';
import Supercluster from 'supercluster';
import { regionToBBox, regionToZoom } from '@/lib/geo';
import { colors, VEHICLE_STATUS_COLOUR } from '@/lib/theme';

interface VehicleMarkersProps {
  vehicles: Vehicle[];
  region: Region;
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
  region,
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
    () => index.getClusters(regionToBBox(region), regionToZoom(region)),
    [index, region],
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
              coordinate={{ latitude: lat, longitude: lon }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
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
        return (
          <Marker
            key={vehicle.id}
            coordinate={{ latitude: vehicle.location.lat, longitude: vehicle.location.lon }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            onPress={() => onSelectVehicle(vehicle)}
          >
            <View
              style={[
                styles.pin,
                { backgroundColor: VEHICLE_STATUS_COLOUR[vehicle.status] },
                selected && styles.pinSelected,
              ]}
            >
              <Text style={styles.pinGlyph}>🛴</Text>
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
  },
  clusterCount: { color: colors.textInverse, fontSize: 14, fontWeight: '700' },
  pin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
    borderColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  pinSelected: {
    transform: [{ scale: 1.25 }],
    borderColor: colors.text,
  },
  pinGlyph: { fontSize: 16 },
});
