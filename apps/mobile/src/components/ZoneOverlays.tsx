import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import type { FillLayerSpecification } from '@maplibre/maplibre-react-native';
import type { Zone } from '@ozothunder/shared';
import { useMemo } from 'react';
import { ZONE_KIND_COLOUR } from '@/lib/theme';

type FillColour = NonNullable<FillLayerSpecification['paint']>['fill-color'];
// Non-nullable: these are nested inside an `interpolate`, and the `| undefined`
// an optional property carries is not a legal stop value there.
type FillOpacity = NonNullable<NonNullable<FillLayerSpecification['paint']>['fill-opacity']>;

/** Data-driven colour: one layer styles every zone kind. */
const COLOUR_BY_KIND: FillColour = [
  'match',
  ['get', 'kind'],
  'parking',
  ZONE_KIND_COLOUR.parking,
  'forbidden',
  ZONE_KIND_COLOUR.forbidden,
  'slow',
  ZONE_KIND_COLOUR.slow,
  ZONE_KIND_COLOUR.service,
];

/**
 * The first symbol layer of the OpenFreeMap Liberty style. Anchoring the zone
 * layers before it puts them above roads and buildings but under every label
 * and POI icon, so a rider can still read the street they are standing on
 * through a zone. Without it MapLibre appends them on top of the basemap and
 * the labels go under the tint.
 */
const BELOW_LABELS = 'waterway_line_label';

/**
 * The calmed zones get a fill layer of their own, because theirs is the only
 * one that has to know about zoom.
 *
 * They are 300–420 m across, so from about z15 the rider is *inside* one and
 * its fill has stopped being a shape — it is a tint over the whole screen,
 * which is what turned the map pink. Zoomed out it still has an outside edge
 * and earns a fill; zoomed in, the outline and the speed disc from
 * `ZoneMarkers` say it just as well, so the fill gets out of the way.
 *
 * Splitting the layer rather than branching inside one: the style spec forbids
 * `["zoom"]` anywhere inside a `case`, so a single layer would have to repeat
 * the whole per-kind expression once per zoom stop.
 */
const SLOW_FILL_OPACITY: FillOpacity = [
  'interpolate',
  ['linear'],
  ['zoom'],
  13,
  ['case', ['get', 'highlighted'], 0.3, 0.1],
  16,
  ['case', ['get', 'highlighted'], 0.3, 0.02],
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
        beforeId={BELOW_LABELS}
        filter={['!=', ['get', 'kind'], 'slow']}
        paint={{
          'fill-color': COLOUR_BY_KIND,
          'fill-opacity': [
            'case',
            // Ahead of the highlight: the service area is city-sized, so a fill
            // at any opacity tints the whole map. Guarded by construction here
            // rather than by what `ZoneMarkers` happens to make tappable.
            ['==', ['get', 'kind'], 'service'],
            0,
            ['get', 'highlighted'],
            0.3,
            // A parking zone is 120 m and has to be *found* — it is the one
            // that gets to be solid.
            ['==', ['get', 'kind'], 'parking'],
            0.22,
            0.12,
          ],
        }}
      />
      <Layer
        id="zone-fill-slow"
        type="fill"
        beforeId={BELOW_LABELS}
        filter={['==', ['get', 'kind'], 'slow']}
        paint={{
          'fill-color': ZONE_KIND_COLOUR.slow,
          'fill-opacity': SLOW_FILL_OPACITY,
        }}
      />
      {/* A forbidden zone's boundary is dashed. Solid, at the 180–320 m scale
          these are drawn at, it read as a hard border across the city rather
          than the edge of an area. */}
      <Layer
        id="zone-outline"
        type="line"
        beforeId={BELOW_LABELS}
        filter={['!=', ['get', 'kind'], 'forbidden']}
        paint={{
          'line-color': COLOUR_BY_KIND,
          'line-width': ['case', ['get', 'highlighted'], 3, 1.5],
          'line-opacity': 0.9,
        }}
      />
      <Layer
        id="zone-outline-forbidden"
        type="line"
        beforeId={BELOW_LABELS}
        filter={['==', ['get', 'kind'], 'forbidden']}
        paint={{
          'line-color': ZONE_KIND_COLOUR.forbidden,
          'line-width': ['case', ['get', 'highlighted'], 3, 1.5],
          'line-opacity': 0.9,
          'line-dasharray': [2, 1.5],
        }}
      />
    </GeoJSONSource>
  );
}
