import { useMemo } from 'react';
import { CircleMarker, MapContainer, Polygon, Popup, TileLayer, Tooltip } from 'react-leaflet';
import { Space, Typography } from 'antd';
import {
  TASHKENT_MAP_CENTER,
  type AdminVehicle,
  type VehicleStatus,
  type Zone,
} from '@scoot/shared';
import { VEHICLE_STATUS_META, ZONE_KIND_META } from './status.js';
import 'leaflet/dist/leaflet.css';

/**
 * Live fleet map. Vehicles are CircleMarkers rather than image pins so 70 of
 * them can move every 3 seconds without Leaflet rebuilding DOM icons.
 */

interface FleetMapProps {
  vehicles: AdminVehicle[];
  zones?: Zone[];
  height?: number | string;
  /** Zones the operator is editing are drawn by the editor instead. */
  showZones?: boolean;
  /** Defaults to the whole city; the vehicle drawer centres on one scooter. */
  center?: { lat: number; lon: number };
  zoom?: number;
}

export function FleetMap({
  vehicles,
  zones = [],
  height = 460,
  showZones = true,
  center,
  zoom = 11,
}: FleetMapProps): React.ReactElement {
  const anchor = center ?? TASHKENT_MAP_CENTER;
  const centre: [number, number] = [anchor.lat, anchor.lon];

  const zonePolygons = useMemo(
    () =>
      showZones
        ? zones.map((zone) => ({
            zone,
            positions: zone.geom.coordinates[0]?.map(
              ([lon, lat]) => [lat, lon] as [number, number],
            ),
          }))
        : [],
    [zones, showZones],
  );

  return (
    <MapContainer
      center={centre}
      zoom={zoom}
      style={{ height, width: '100%', borderRadius: 6 }}
      preferCanvas
    >
      <TileLayer
        attribution="&copy; OpenStreetMap"
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
      />

      {zonePolygons.map(({ zone, positions }) =>
        positions === undefined ? null : (
          <Polygon
            key={zone.id}
            positions={positions}
            pathOptions={{
              color: ZONE_KIND_META[zone.kind]?.colour ?? '#1677ff',
              weight: zone.kind === 'service' ? 1 : 2,
              fillOpacity: zone.kind === 'service' ? 0.03 : 0.15,
              dashArray: zone.kind === 'forbidden' ? '6 4' : undefined,
            }}
          >
            <Tooltip>{zone.name}</Tooltip>
          </Polygon>
        ),
      )}

      {vehicles.map((vehicle) => (
        <CircleMarker
          key={vehicle.id}
          center={[vehicle.location.lat, vehicle.location.lon]}
          radius={6}
          pathOptions={{
            color: '#ffffff',
            weight: 1.5,
            fillColor: colourFor(vehicle.status),
            fillOpacity: 0.95,
          }}
        >
          <Popup>
            <Space direction="vertical" size={0}>
              <Typography.Text strong>{vehicle.qrCode}</Typography.Text>
              <Typography.Text type="secondary">{vehicle.model}</Typography.Text>
              <Typography.Text>{VEHICLE_STATUS_META[vehicle.status].label}</Typography.Text>
              <Typography.Text>
                Заряд {vehicle.batteryPct}% · запас {(vehicle.rangeM / 1000).toFixed(1)} км
              </Typography.Text>
            </Space>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}

function colourFor(status: VehicleStatus): string {
  return VEHICLE_STATUS_META[status].colour;
}

/** Shared legend so map colours are readable without clicking a pin. */
export function FleetLegend(): React.ReactElement {
  return (
    <Space size={12} wrap style={{ marginTop: 8 }}>
      {(Object.keys(VEHICLE_STATUS_META) as VehicleStatus[]).map((status) => (
        <Space key={status} size={4}>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: VEHICLE_STATUS_META[status].colour,
            }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {VEHICLE_STATUS_META[status].label}
          </Typography.Text>
        </Space>
      ))}
    </Space>
  );
}
