import { Marker } from '@maplibre/maplibre-react-native';
import type { Zone } from '@scoot/shared';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/ui';
import { polygonCentroid } from '@/lib/geo';
import { colors, numeric, outline, shadows, ZONE_KIND_COLOUR } from '@/lib/theme';

/**
 * Zoom at which zone badges appear. Below this the city view is dense enough
 * that a badge per zone competes with the scooter pins for the same pixels,
 * and the polygon fills already carry the information.
 */
const BADGE_MIN_ZOOM = 13;

/**
 * A badge at the centre of each parking and slow zone.
 *
 * The polygons alone are readable only once you know the colour code — the
 * reference map puts a literal "P" on every parking spot, and it is the single
 * clearest thing on that screen. Slow zones get their limit as a number, so
 * "20" answers the question without a tap.
 *
 * Forbidden and service zones get nothing: one is a shape you are meant to
 * stay out of, the other is the whole city.
 */
export function ZoneMarkers({
  zones,
  zoom,
  onPress,
}: {
  zones: Zone[];
  zoom: number;
  onPress: (zone: Zone) => void;
}) {
  const badges = useMemo(
    () =>
      zones
        .filter((zone) => zone.kind === 'parking' || zone.kind === 'slow')
        .map((zone) => ({ zone, centre: polygonCentroid(zone.geom) })),
    [zones],
  );

  if (zoom < BADGE_MIN_ZOOM) return null;

  return (
    <>
      {badges.map(({ zone, centre }) => (
        <Marker key={zone.id} lngLat={[centre.lon, centre.lat]} onPress={() => onPress(zone)}>
          {zone.kind === 'parking' ? (
            <View style={[styles.badge, { backgroundColor: ZONE_KIND_COLOUR.parking }]}>
              <Icon name="parking" size={17} color={colors.text} />
            </View>
          ) : (
            <View style={[styles.badge, styles.speedBadge]}>
              <Text style={styles.speedLabel}>{zone.speedLimitKph ?? '—'}</Text>
            </View>
          )}
        </Marker>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    ...outline,
    ...shadows.sm,
  },
  // A speed limit is a road sign the world over: white disc, coloured ring.
  speedBadge: {
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: ZONE_KIND_COLOUR.slow,
  },
  speedLabel: { fontSize: 12, fontWeight: '800', color: colors.text, ...numeric },
});
