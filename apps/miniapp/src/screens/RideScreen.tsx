import type { ActiveRide, LatLon, ParkingCheck, Plan, Zone } from '@scoot/shared';
import { calculateRideCost, formatSom } from '@scoot/shared';
import maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import {
  DEMO_CONTROLS_ENABLED,
  MAP_STYLE_URL,
  ZONE_KIND_COLOUR,
  formatDistance,
  formatDuration,
  pointInPolygon,
  polygonCentroid,
} from '../lib';
import { confirmDialog } from '../telegram';

interface RideScreenProps {
  ride: ActiveRide;
  zones: Zone[];
  plan: Plan | null;
  ending: boolean;
  blocked: ParkingCheck | null;
  onEnd: (location: LatLon) => void;
  onDismissBlocked: () => void;
  onBeep: () => void;
  beepNote: string | null;
}

export function RideScreen({
  ride,
  zones,
  plan,
  ending,
  blocked,
  onEnd,
  onDismissBlocked,
  onBeep,
  beepNote,
}: RideScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const riderMarkerRef = useRef<maplibregl.Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Dev-only stand-in for walking into a parking zone (demo step 5) —
  // mirrors the native app's "step into zone" control.
  const [devLocation, setDevLocation] = useState<LatLon | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const map = new maplibregl.Map({
      container,
      style: MAP_STYLE_URL,
      center: [ride.vehicle.location.lon, ride.vehicle.location.lat],
      zoom: 15.5,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    const pin = document.createElement('div');
    pin.className = 'ride-pin';
    pin.textContent = '🛴';
    markerRef.current = new maplibregl.Marker({ element: pin })
      .setLngLat([ride.vehicle.location.lon, ride.vehicle.location.lat])
      .addTo(map);

    map.on('load', () => {
      map.addSource('zones', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
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
            ZONE_KIND_COLOUR.service,
          ],
          'fill-opacity': [
            'case',
            ['==', ['get', 'kind'], 'service'],
            0,
            ['case', ['get', 'highlighted'], 0.3, 0.15],
          ],
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
            ZONE_KIND_COLOUR.service,
          ],
          'line-width': ['case', ['get', 'highlighted'], 4, 2],
        },
      });
      map.addSource('path', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'path-line',
        type: 'line',
        source: 'path',
        paint: { 'line-color': '#1677FF', 'line-width': 4 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
      setMapReady(true);
    });

    return () => {
      setMapReady(false);
      mapRef.current = null;
      map.remove();
    };
    // The map exists for the lifetime of the ride screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nearest = blocked?.nearestParkingZone ?? null;

  // Zones + highlight of the nearest legal zone while blocked.
  useEffect(() => {
    if (!mapReady) return;
    mapRef.current?.getSource<maplibregl.GeoJSONSource>('zones')?.setData({
      type: 'FeatureCollection',
      features: zones.map((zone) => ({
        type: 'Feature',
        geometry: zone.geom,
        properties: { kind: zone.kind, highlighted: zone.id === nearest?.id },
      })),
    });
  }, [mapReady, zones, nearest?.id]);

  // Follow the scooter as the simulator moves it; draw the travelled path.
  const { lat: vLat, lon: vLon } = ride.vehicle.location;
  useEffect(() => {
    markerRef.current?.setLngLat([vLon, vLat]);
    mapRef.current?.easeTo({ center: [vLon, vLat], zoom: 15.5, duration: 900 });
  }, [vLat, vLon]);

  useEffect(() => {
    if (!mapReady) return;
    const path = ride.path;
    mapRef.current?.getSource<maplibregl.GeoJSONSource>('path')?.setData(
      path !== null && path.coordinates.length >= 2
        ? { type: 'Feature', geometry: path, properties: {} }
        : { type: 'FeatureCollection', features: [] },
    );
  }, [mapReady, ride.path]);

  // Rider dot when the dev control has placed them somewhere specific.
  useEffect(() => {
    if (devLocation === null) {
      riderMarkerRef.current?.remove();
      riderMarkerRef.current = null;
      return;
    }
    if (riderMarkerRef.current === null) {
      const dot = document.createElement('div');
      dot.className = 'rider-dot';
      riderMarkerRef.current = new maplibregl.Marker({ element: dot });
      const map = mapRef.current;
      if (map !== null) riderMarkerRef.current.addTo(map);
    }
    riderMarkerRef.current.setLngLat([devLocation.lon, devLocation.lat]);
  }, [devLocation]);

  // Frame rider + nearest zone — on rejection, and again from the
  // "Показать парковку" button.
  const frameBlocked = (): void => {
    if (nearest === null) return;
    const rider = devLocation ?? ride.vehicle.location;
    const centre = polygonCentroid(nearest.geom);
    const MIN_SPAN = 0.006;
    const west = Math.min(rider.lon, centre.lon);
    const south = Math.min(rider.lat, centre.lat);
    const east = Math.max(rider.lon, centre.lon);
    const north = Math.max(rider.lat, centre.lat);
    const lonGrow = Math.max(0, (MIN_SPAN - (east - west)) / 2);
    const latGrow = Math.max(0, (MIN_SPAN - (north - south)) / 2);
    mapRef.current?.fitBounds(
      [west - lonGrow, south - latGrow, east + lonGrow, north + latGrow],
      { padding: { top: 60, bottom: 60, left: 40, right: 40 }, duration: 600 },
    );
  };

  useEffect(() => {
    frameBlocked();
    // Framing uses the rider position at the moment of rejection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearest]);

  // A billed ride must not end on an accidental tap.
  const confirmEnd = async (): Promise<void> => {
    if (await confirmDialog('Завершить поездку?')) {
      onEnd(riderLocation);
    }
  };

  const riderLocation = devLocation ?? ride.vehicle.location;
  const parkingZones = zones.filter((zone) => zone.kind === 'parking');
  const inParking = parkingZones.some((zone) => pointInPolygon(riderLocation, zone.geom));

  const durationS = Math.max(0, (now - new Date(ride.startedAt).getTime()) / 1000);
  // The same pure function the API charges with — the ticker cannot
  // disagree with the receipt.
  const liveCost =
    plan !== null
      ? calculateRideCost({
          plan: { kind: plan.kind, unlockFee: plan.unlockFee, price: plan.price },
          durationS,
          distanceM: ride.distanceM,
        }).total
      : ride.currentCost;

  const blockedReason =
    blocked?.reason === 'inside_forbidden_zone'
      ? 'Здесь парковка запрещена'
      : blocked?.reason === 'outside_service_area'
        ? 'Вы за пределами зоны обслуживания'
        : 'Вы вне парковочной зоны';

  return (
    <div className="screen ride-screen">
      <div ref={containerRef} className="map" />

      <div className="map-topbar">
        <span className="chip">
          Поездка · <b>{ride.vehicle.qrCode}</b>
        </span>
        {beepNote !== null && <span className="chip">{beepNote}</span>}
      </div>

      <div className="panel">
        <div className="stat-row">
          <div className="stat">
            <span className="muted">Время</span>
            <b>{formatDuration(durationS)}</b>
          </div>
          <div className="stat">
            <span className="muted">Расстояние</span>
            <b>{formatDistance(ride.distanceM)}</b>
          </div>
          <div className="stat">
            <span className="muted">Стоимость</span>
            <b className="highlight">{formatSom(liveCost)}</b>
          </div>
        </div>

        <div className="pill-row">
          <span className={inParking ? 'pill pill-ok' : 'pill'}>
            {inParking ? 'В парковочной зоне' : 'Вне парковочной зоны'}
          </span>
          <button className="btn small ghost" onClick={onBeep}>
            🔔 Сигнал
          </button>
        </div>

        {blocked !== null && (
          <div className="blocked-card">
            <b>Здесь нельзя завершить поездку</b>
            <div className="muted">{blockedReason}</div>
            {nearest !== null && (
              <div>
                Ближайшая парковка: <b>{nearest.name}</b> —{' '}
                {formatDistance(nearest.distanceM)} пешком
              </div>
            )}
            <div className="row">
              {nearest !== null && (
                <button className="btn small" onClick={frameBlocked}>
                  Показать парковку
                </button>
              )}
              {DEMO_CONTROLS_ENABLED && nearest !== null && (
                <button
                  className="btn small"
                  onClick={() => {
                    setDevLocation(polygonCentroid(nearest.geom));
                    onDismissBlocked();
                  }}
                >
                  Перейти в зону (демо)
                </button>
              )}
              <button className="btn small ghost" onClick={onDismissBlocked}>
                Понятно
              </button>
            </div>
          </div>
        )}

        <button
          className={inParking ? 'btn primary' : 'btn danger'}
          disabled={ending}
          onClick={() => void confirmEnd()}
        >
          {ending ? 'Завершение…' : 'Завершить поездку'}
        </button>
      </div>
    </div>
  );
}
