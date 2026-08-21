import type { Plan, Vehicle, Zone } from '@ozothunder/shared';
import { formatSom } from '@ozothunder/shared';
import type { FeatureCollection, Point } from 'geojson';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MAP_CENTER,
  MAP_STYLE_URL,
  VEHICLE_STATUS_COLOUR,
  ZONE_KIND_COLOUR,
  formatDistance,
} from '../lib';

interface MapScreenProps {
  vehicles: Vehicle[];
  zones: Zone[];
  perMinutePlan: Plan | null;
  /** Selection lives in App — the shared scan flow also selects vehicles. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  unlocking: boolean;
  unlockError: string | null;
  onUnlock: (vehicle: Vehicle) => void;
  onClearUnlockError: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  loadError: boolean;
}

/** GeoJSON for the clustered vehicle source. */
function vehiclesToGeoJSON(vehicles: Vehicle[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: vehicles.map((v) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [v.location.lon, v.location.lat] },
      properties: { id: v.id, status: v.status },
    })),
  };
}

function zonesToGeoJSON(zones: Zone[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: zones.map((zone) => ({
      type: 'Feature',
      geometry: zone.geom,
      properties: { kind: zone.kind },
    })),
  };
}

export function MapScreen({
  vehicles,
  zones,
  perMinutePlan,
  selectedId,
  onSelect,
  unlocking,
  unlockError,
  onUnlock,
  onClearUnlockError,
  onRefresh,
  refreshing,
  loadError,
}: MapScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Click handlers need the current fleet without re-binding map listeners.
  const vehiclesRef = useRef(vehicles);
  vehiclesRef.current = vehicles;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const selected = vehicles.find((v) => v.id === selectedId) ?? null;

  // The selected vehicle can be unlocked by someone else and leave the
  // public list — drop the stale selection, same rule as the native app.
  useEffect(() => {
    if (selectedId !== null && selected === null) onSelect(null);
  }, [selectedId, selected, onSelect]);

  // A selection arriving from the scan flow should focus the map on it.
  useEffect(() => {
    if (selected === null) return;
    mapRef.current?.easeTo({
      center: [selected.location.lon, selected.location.lat],
      zoom: 15.2,
      duration: 350,
    });
    // Deliberately only when the id changes — the vehicle jitters every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const map = new maplibregl.Map({
      container,
      style: MAP_STYLE_URL,
      center: MAP_CENTER,
      zoom: 10.5,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.on('load', () => {
      map.addSource('zones', { type: 'geojson', data: zonesToGeoJSON([]) });
      map.addLayer({
        id: 'zone-fill',
        type: 'fill',
        source: 'zones',
        paint: {
          'fill-color': [
            'match',
            ['get', 'kind'],
            'parking',
            ZONE_KIND_COLOUR.parking,
            'forbidden',
            ZONE_KIND_COLOUR.forbidden,
            'slow',
            ZONE_KIND_COLOUR.slow,
            ZONE_KIND_COLOUR.service,
          ],
          'fill-opacity': ['case', ['==', ['get', 'kind'], 'service'], 0, 0.15],
        },
      });
      map.addLayer({
        id: 'zone-line',
        type: 'line',
        source: 'zones',
        paint: {
          'line-color': [
            'match',
            ['get', 'kind'],
            'parking',
            ZONE_KIND_COLOUR.parking,
            'forbidden',
            ZONE_KIND_COLOUR.forbidden,
            'slow',
            ZONE_KIND_COLOUR.slow,
            ZONE_KIND_COLOUR.service,
          ],
          'line-width': 2,
        },
      });

      map.addSource('vehicles', {
        type: 'geojson',
        data: vehiclesToGeoJSON([]),
        cluster: true,
        clusterRadius: 52,
        clusterMaxZoom: 17,
      });
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'vehicles',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#1F1F1F',
          'circle-radius': 18,
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#FFFFFF',
        },
      });
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'vehicles',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 13,
        },
        paint: { 'text-color': '#FFFFFF' },
      });
      map.addLayer({
        id: 'vehicle-pins',
        type: 'circle',
        source: 'vehicles',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': [
            'match',
            ['get', 'status'],
            'available',
            VEHICLE_STATUS_COLOUR.available,
            'low_battery',
            VEHICLE_STATUS_COLOUR.low_battery,
            VEHICLE_STATUS_COLOUR.offline,
          ],
          'circle-radius': 12,
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#FFFFFF',
        },
      });

      map.on('click', 'clusters', (e) => {
        const feature = e.features?.[0];
        const clusterId = feature?.properties?.['cluster_id'] as number | undefined;
        if (feature === undefined || clusterId === undefined) return;
        const source = map.getSource<maplibregl.GeoJSONSource>('vehicles');
        void source?.getClusterExpansionZoom(clusterId).then((zoom) => {
          const [lon, lat] = (feature.geometry as Point).coordinates;
          if (lon !== undefined && lat !== undefined) {
            map.easeTo({ center: [lon, lat], zoom: Math.min(zoom, 18), duration: 350 });
          }
        });
      });

      map.on('click', 'vehicle-pins', (e) => {
        const id = e.features?.[0]?.properties?.['id'] as string | undefined;
        if (id === undefined) return;
        // The selection-focus effect handles easing the camera over.
        onSelectRef.current(id);
      });

      ['clusters', 'vehicle-pins'].forEach((layer) => {
        map.on('mouseenter', layer, () => {
          map.getCanvas().style.cursor = 'pointer';
        });
        map.on('mouseleave', layer, () => {
          map.getCanvas().style.cursor = '';
        });
      });

      setMapReady(true);
    });

    return () => {
      setMapReady(false);
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    mapRef.current?.getSource<maplibregl.GeoJSONSource>('vehicles')?.setData(
      vehiclesToGeoJSON(vehicles),
    );
  }, [mapReady, vehicles]);

  useEffect(() => {
    if (!mapReady) return;
    mapRef.current?.getSource<maplibregl.GeoJSONSource>('zones')?.setData(zonesToGeoJSON(zones));
  }, [mapReady, zones]);

  const tariffLine = useMemo(() => {
    if (perMinutePlan === null) return null;
    return `${formatSom(perMinutePlan.price)}/мин · разблокировка ${formatSom(perMinutePlan.unlockFee)}`;
  }, [perMinutePlan]);

  return (
    <div className="screen map-screen">
      <div ref={containerRef} className="map" />

      <div className="map-topbar">
        <span className="chip">{vehicles.length} самокатов</span>
        <button className="chip chip-button" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? '…' : '⟳ Обновить'}
        </button>
      </div>

      {loadError && (
        <div className="error-banner">
          Не удалось загрузить данные.{' '}
          <button className="link" onClick={onRefresh}>
            Повторить
          </button>
        </div>
      )}

      {selected !== null && (
        <div className="sheet">
          <div className="sheet-head">
            <div>
              <div className="sheet-title">{selected.qrCode}</div>
              <div className="muted">{selected.model}</div>
            </div>
            <button
              className="close"
              onClick={() => {
                onSelect(null);
                onClearUnlockError();
              }}
            >
              ✕
            </button>
          </div>
          <div className="stat-row">
            <div className="stat">
              <span className="muted">Заряд</span>
              <b>{selected.batteryPct}%</b>
            </div>
            <div className="stat">
              <span className="muted">Запас хода</span>
              <b>{formatDistance(selected.rangeM)}</b>
            </div>
          </div>
          {tariffLine !== null && <div className="tariff">{tariffLine}</div>}
          {unlockError !== null && <div className="error-box">{unlockError}</div>}
          <button
            className="btn primary"
            disabled={unlocking || perMinutePlan === null}
            onClick={() => onUnlock(selected)}
          >
            {unlocking ? 'Разблокировка…' : unlockError !== null ? 'Попробовать ещё раз' : 'Разблокировать'}
          </button>
        </div>
      )}
    </div>
  );
}
