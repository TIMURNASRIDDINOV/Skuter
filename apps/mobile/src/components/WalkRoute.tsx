import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import type { LatLon } from '@ozothunder/shared';
import { haversineDistanceM } from '@ozothunder/shared';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui';
import { walkMinutes } from '@/lib/fleet';
import { useI18n } from '@/lib/i18n';
import { colors, numeric, radius, shadows, spacing } from '@/lib/theme';

/**
 * The dashed walk line from the rider to the scooter they picked, with the
 * time-on-foot pill sitting on it.
 *
 * **A straight line, and it says so by being dashed.** There is no routing
 * service here — adding a keyed one is exactly the dependency this project
 * avoids — so drawing a confident solid line down streets the app has not
 * computed would be a fabrication. A dashed geodesic reads as "this way, about
 * this far", which is all it is and all the rider needs to start walking.
 *
 * Renders nothing until the device has a fix; a route drawn from a guessed
 * origin is worse than no route.
 */
export function WalkRoute({ from, to }: { from: LatLon | null; to: LatLon }) {
  const { t } = useI18n();

  const line = useMemo(
    () =>
      from === null
        ? null
        : ({
            type: 'FeatureCollection' as const,
            features: [
              {
                type: 'Feature' as const,
                properties: {},
                geometry: {
                  type: 'LineString' as const,
                  coordinates: [
                    [from.lon, from.lat],
                    [to.lon, to.lat],
                  ],
                },
              },
            ],
          }),
    [from, to],
  );

  if (from === null || line === null) return null;

  const distanceM = haversineDistanceM(from, to);
  const midpoint: [number, number] = [(from.lon + to.lon) / 2, (from.lat + to.lat) / 2];

  return (
    <>
      <GeoJSONSource id="walk-route" data={line}>
        <Layer
          id="walk-route-line"
          type="line"
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{
            'line-color': colors.text,
            'line-width': 3.5,
            'line-opacity': 0.75,
            'line-dasharray': [0.1, 1.9],
          }}
        />
      </GeoJSONSource>

      <Marker lngLat={midpoint}>
        <View style={styles.pill} pointerEvents="none">
          <Icon name="walk" size={13} color={colors.text} />
          <Text style={styles.pillLabel}>
            {walkMinutes(distanceM)} {t.minutesShort}
          </Text>
        </View>
      </Marker>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: spacing.s + 2,
    paddingVertical: 5,
    ...shadows.md,
  },
  pillLabel: { fontSize: 13, fontWeight: '700', color: colors.text, ...numeric },
});
