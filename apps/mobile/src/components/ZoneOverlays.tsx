import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import type { FillLayerSpecification } from '@maplibre/maplibre-react-native';
import type { Zone } from '@scoot/shared';
import { useMemo } from 'react';
import { ZONE_KIND_COLOUR } from '@/lib/theme';

type FillColour = NonNullable<FillLayerSpecification['paint']>['fill-color'];

/** Data-driven colour: one layer styles every zone kind. */
const COLOUR_BY_KIND: FillColour = [
  'match',
  ['get', 'kind'],
  'parking',
  ZONE_KIND_COLOUR.parking,
  'forbidden',
  ZONE_KIND_COLOUR.forbidden,
  ZONE_KIND_COLOUR.service,
];

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
  const collection = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: zones.map((zone) => ({
        type: 'Feature' as const,
        geometry: zone.geom,
        properties: {
          kind: zone.kind,
          highlighted: zone.id === highlightedZoneId,
        },
      })),
    }),
    [zones, highlightedZoneId],
  );

  return (
    <GeoJSONSource id="zones" data={collection}>
      <Layer
        id="zone-fill"
        type="fill"
        paint={{
          'fill-color': COLOUR_BY_KIND,
          'fill-opacity': [
            'case',
            ['==', ['get', 'kind'], 'service'],
            0,
            ['case', ['get', 'highlighted'], 0.3, 0.15],
          ],
        }}
      />
      <Layer
        id="zone-outline"
        type="line"
        paint={{
          'line-color': COLOUR_BY_KIND,
          'line-width': ['case', ['get', 'highlighted'], 4, 2],
        }}
      />
    </GeoJSONSource>
  );
}
