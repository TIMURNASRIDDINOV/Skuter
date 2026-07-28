import type { Zone } from '@scoot/shared';
import { Polygon } from 'react-native-maps';
import { polygonToLatLngs } from '@/lib/geo';
import { ZONE_KIND_COLOUR } from '@/lib/theme';

/**
 * Zone polygons. Parking zones fill green, forbidden fill red, the service
 * area is an outline only — a filled city-sized polygon would tint the
 * whole map.
 */
export function ZoneOverlays({
  zones,
  highlightedZoneId,
}: {
  zones: Zone[];
  highlightedZoneId?: string | null;
}) {
  return (
    <>
      {zones.map((zone) => {
        const colour = ZONE_KIND_COLOUR[zone.kind];
        const highlighted = zone.id === highlightedZoneId;
        return (
          <Polygon
            key={zone.id}
            coordinates={polygonToLatLngs(zone.geom)}
            strokeColor={colour}
            strokeWidth={highlighted ? 4 : 2}
            fillColor={
              zone.kind === 'service'
                ? 'transparent'
                : `${colour}${highlighted ? '4D' : '26'}`
            }
          />
        );
      })}
    </>
  );
}
