import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Col,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Typography,
  theme,
} from 'antd';
import { DeleteOutlined, EditOutlined, WarningFilled } from '@ant-design/icons';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-draw';
import {
  BUKHARA_MAP_CENTER,
  isPointInPolygon,
  type AdminVehicle,
  type GeoPolygon,
  type Zone,
  type ZoneKind,
} from '@ozothunder/shared';
import { apiFetch, type ListResponse } from '../lib/api.js';
import { useLiveFleet } from '../lib/useLiveFleet.js';
import { plural } from '../lib/format.js';
import { SEVERITY_META, VEHICLE_STATUS_META, ZONE_KIND_META } from '../components/status.js';
import { MapAutoSize } from '../components/MapAutoSize.js';
import { ErrorState, TableSkeleton } from '../components/states.js';
import { useAdminSession } from '../providers/session.js';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';

/** Service area first: it is the one whose edges strand scooters. */
const KIND_ORDER: readonly ZoneKind[] = ['service', 'parking', 'forbidden', 'slow'];

/** Offered speed caps. Free entry invites 3 km/h, which is not a scooter. */
const SPEED_LIMIT_OPTIONS = [5, 10, 15, 20, 25] as const;

/** The default cap when an operator switches a zone to `slow`. */
const DEFAULT_SPEED_LIMIT_KPH = 15;

interface ZoneFormValues {
  name: string;
  kind: ZoneKind;
  /** Only read when `kind` is `slow`; the field is hidden otherwise. */
  speedLimitKph?: number;
}

/**
 * Zone editor — demo step 7. Draw a polygon on the map, name it, save, and it
 * is immediately live for the rider app's next refresh.
 *
 * The fleet is drawn underneath the zones, because a zone boundary only means
 * something in relation to the scooters it does or does not contain. Drawing a
 * service area without seeing which vehicles fall outside it is how you strand
 * a fleet, and it is what this screen used to make you do.
 */
export function ZonesPage(): React.ReactElement {
  const { message } = AntApp.useApp();
  const canManage = useAdminSession().can('zones', 'manage');
  const { vehicles } = useLiveFleet();
  const [zones, setZones] = useState<Zone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GeoPolygon | null>(null);
  const [editing, setEditing] = useState<Zone | null>(null);
  const [showFleet, setShowFleet] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);
  // Identity matters: MapAutoSize re-frames whenever this array changes, and
  // the fleet re-renders this page every few seconds. A fresh `[]` per render
  // would snatch the map back mid-drag.
  const [focus, setFocus] = useState<[number, number][]>([]);
  const [form] = Form.useForm<ZoneFormValues>();
  // Drives the conditional speed field. `Form.useWatch` rather than local
  // state, so it also tracks the value written by setFieldsValue when an
  // existing zone is opened for editing.
  const kind = Form.useWatch('kind', form);
  const { token } = theme.useToken();

  const load = useCallback(() => {
    apiFetch<ListResponse<Zone>>('/admin/zones')
      .then((response) => {
        setZones(response.items);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить зоны');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(load, [load]);

  const serviceZones = useMemo(() => zones.filter((zone) => zone.kind === 'service'), [zones]);

  /** Vehicles stranded outside every service area, live. */
  const outside = useMemo(() => {
    if (serviceZones.length === 0) return [];
    return vehicles.filter(
      (vehicle) => !serviceZones.some((zone) => isPointInPolygon(vehicle.location, zone.geom)),
    );
  }, [vehicles, serviceZones]);

  const outsideIds = useMemo(() => new Set(outside.map((vehicle) => vehicle.id)), [outside]);

  const countInside = useCallback(
    (zone: Zone): number =>
      vehicles.filter((vehicle) => isPointInPolygon(vehicle.location, zone.geom)).length,
    [vehicles],
  );

  const save = useCallback(
    async (values: ZoneFormValues) => {
      // The API rejects a limit on any kind but `slow`, so send it only there.
      const speedLimitKph = values.kind === 'slow' ? (values.speedLimitKph ?? null) : null;
      try {
        if (editing !== null) {
          await apiFetch<Zone>(`/admin/zones/${editing.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: values.name, kind: values.kind, speedLimitKph }),
          });
          message.success('Зона обновлена');
        } else {
          if (draft === null) return;
          await apiFetch<Zone>('/admin/zones', {
            method: 'POST',
            body: JSON.stringify({
              name: values.name,
              kind: values.kind,
              geom: draft,
              speedLimitKph,
            }),
          });
          message.success('Зона сохранена — обновите приложение, чтобы увидеть её');
        }
        setDraft(null);
        setEditing(null);
        form.resetFields();
        load();
      } catch (cause: unknown) {
        message.error(cause instanceof Error ? cause.message : 'Не удалось сохранить зону');
      }
    },
    [draft, editing, form, load, message],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await apiFetch(`/admin/zones/${id}`, { method: 'DELETE' });
        message.success('Зона удалена');
        load();
      } catch (cause: unknown) {
        message.error(cause instanceof Error ? cause.message : 'Не удалось удалить зону');
      }
    },
    [load, message],
  );

  const updateGeometry = useCallback(
    async (id: string, geom: GeoPolygon) => {
      try {
        await apiFetch<Zone>(`/admin/zones/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ geom }),
        });
        message.success('Границы зоны обновлены');
        load();
      } catch (cause: unknown) {
        message.error(cause instanceof Error ? cause.message : 'Не удалось обновить зону');
        load();
      }
    },
    [load, message],
  );

  const focusZone = useCallback((zone: Zone) => {
    const ring = zone.geom.coordinates[0];
    if (ring === undefined) return;
    setFocus(ring.map(([lon, lat]) => [lat, lon] as [number, number]));
  }, []);

  if (error !== null) return <ErrorState message={error} onRetry={load} />;

  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    items: zones.filter((zone) => zone.kind === kind),
  })).filter((group) => group.items.length > 0);

  return (
    <Row gutter={[12, 12]}>
      <Col xs={24} xl={17}>
        <Card
          size="small"
          title="Редактор зон"
          extra={
            <Space size={14}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                Инструмент многоугольника слева — обведите область
              </Typography.Text>
              <Space size={6}>
                <Switch size="small" checked={showFleet} onChange={setShowFleet} />
                <Typography.Text style={{ fontSize: 12 }}>Парк</Typography.Text>
              </Space>
            </Space>
          }
        >
          <MapContainer
            center={[BUKHARA_MAP_CENTER.lat, BUKHARA_MAP_CENTER.lon]}
            zoom={11}
            style={{ height: 560, width: '100%', borderRadius: 6 }}
            preferCanvas
          >
            <TileLayer
              attribution="&copy; OpenStreetMap"
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            />

            {/* Vehicles render before the draw layer so zone outlines and their
                drag handles stay on top and remain grabbable. */}
            {showFleet
              ? vehicles.map((vehicle) => (
                  <VehicleDot
                    key={vehicle.id}
                    vehicle={vehicle}
                    stranded={outsideIds.has(vehicle.id)}
                  />
                ))
              : null}

            <MapAutoSize positions={focus} padding={40} maxZoom={15} />

            {/* Read-only admins get the map without the drawing toolbar —
                the zone write endpoints refuse them anyway. */}
            {canManage ? (
              <DrawControl
                zones={zones}
                highlighted={hovered}
                onDrawn={setDraft}
                onEdited={(id, geom) => {
                  void updateGeometry(id, geom);
                }}
              />
            ) : null}
          </MapContainer>

          <Space size={14} wrap style={{ marginTop: 8 }}>
            {KIND_ORDER.map((kind) => (
              <Space key={kind} size={5}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 12,
                    height: 8,
                    borderRadius: 2,
                    border: `1.5px ${kind === 'forbidden' ? 'dashed' : 'solid'} ${ZONE_KIND_META[kind]?.colour ?? token.colorPrimary}`,
                    background: `${ZONE_KIND_META[kind]?.colour ?? token.colorPrimary}22`,
                  }}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {ZONE_KIND_META[kind]?.label ?? kind}
                </Typography.Text>
              </Space>
            ))}
            {showFleet ? (
              <Space size={5}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    background: SEVERITY_META.alarm.colour,
                  }}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Вне зоны обслуживания
                </Typography.Text>
              </Space>
            ) : null}
          </Space>
        </Card>
      </Col>

      <Col xs={24} xl={7}>
        <Card size="small" style={{ height: '100%' }}>
          <Typography.Text strong>
            Зоны{' '}
            <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
              {zones.length}
            </Typography.Text>
          </Typography.Text>

          {/* What needs attention on this screen: the boundary is wrong, or a
              scooter has left it. Clicking frames them so it can be fixed by
              redrawing rather than hunted for on another page. */}
          {outside.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setFocus(outside.map((v) => [v.location.lat, v.location.lon]));
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                marginTop: 10,
                padding: '7px 9px',
                textAlign: 'left',
                cursor: 'pointer',
                borderRadius: token.borderRadius,
                background: token.colorErrorBg,
                border: `1px solid ${token.colorErrorBorder}`,
              }}
            >
              <WarningFilled style={{ color: SEVERITY_META.alarm.colour }} />
              <Typography.Text style={{ fontSize: 12 }}>
                {outside.length}{' '}
                {plural(outside.length, 'самокат', 'самоката', 'самокатов')} за пределами зоны
                обслуживания
              </Typography.Text>
            </button>
          ) : null}

          {isLoading ? (
            <div style={{ marginTop: 10 }}>
              <TableSkeleton rows={6} />
            </div>
          ) : zones.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center' }}>
              <Typography.Text type="secondary">
                Зон пока нет — обведите первую на карте
              </Typography.Text>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              {grouped.map((group) => (
                <div key={group.kind} style={{ marginBottom: 12 }}>
                  <Typography.Text
                    type="secondary"
                    style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}
                  >
                    {ZONE_KIND_META[group.kind]?.label ?? group.kind}
                  </Typography.Text>

                  {group.items.map((zone) => (
                    <div
                      key={zone.id}
                      onMouseEnter={() => {
                        setHovered(zone.id);
                      }}
                      onMouseLeave={() => {
                        setHovered(null);
                      }}
                      onClick={() => {
                        focusZone(zone);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 4px',
                        cursor: 'pointer',
                        borderBottom: `1px solid ${token.colorBorderSecondary}`,
                        background:
                          hovered === zone.id ? token.colorFillQuaternary : 'transparent',
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 6,
                          flex: '0 0 auto',
                          borderRadius: 1,
                          border: `1.5px ${zone.kind === 'forbidden' ? 'dashed' : 'solid'} ${ZONE_KIND_META[zone.kind]?.colour ?? token.colorPrimary}`,
                        }}
                      />

                      <Typography.Text ellipsis style={{ flex: 1, minWidth: 0 }}>
                        {zone.name}
                      </Typography.Text>

                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}
                      >
                        {countInside(zone)}
                      </Typography.Text>

                      <Button
                        size="small"
                        type="text"
                        icon={<EditOutlined />}
                        style={{ display: canManage ? undefined : 'none' }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditing(zone);
                          form.setFieldsValue({
                            name: zone.name,
                            kind: zone.kind,
                            speedLimitKph: zone.speedLimitKph ?? DEFAULT_SPEED_LIMIT_KPH,
                          });
                        }}
                      />

                      <Popconfirm
                        title="Удалить зону?"
                        description={
                          zone.kind === 'service'
                            ? 'Это зона обслуживания. Без неё весь парк окажется вне границ.'
                            : `Внутри сейчас ${String(countInside(zone))} ${plural(countInside(zone), 'самокат', 'самоката', 'самокатов')}. Действие нельзя отменить.`
                        }
                        okText="Удалить"
                        cancelText="Отмена"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => {
                          void remove(zone.id);
                        }}
                      >
                        <Button
                          size="small"
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          style={{ display: canManage ? undefined : 'none' }}
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                        />
                      </Popconfirm>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Card>
      </Col>

      <Modal
        open={draft !== null || editing !== null}
        title={editing === null ? 'Новая зона' : 'Изменить зону'}
        okText="Сохранить"
        cancelText="Отмена"
        onCancel={() => {
          setDraft(null);
          setEditing(null);
          form.resetFields();
        }}
        onOk={() => {
          void form.submit();
        }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={save}
          initialValues={{ kind: 'parking', speedLimitKph: DEFAULT_SPEED_LIMIT_KPH }}
        >
          <Form.Item
            name="name"
            label="Название"
            rules={[{ required: true, message: 'Укажите название' }]}
          >
            <Input placeholder="Например: Парковка у метро Пушкина" />
          </Form.Item>
          <Form.Item name="kind" label="Тип" rules={[{ required: true }]}>
            <Select
              options={KIND_ORDER.map((kind) => ({
                value: kind,
                label: ZONE_KIND_META[kind]?.label ?? kind,
              }))}
            />
          </Form.Item>
          {kind !== 'slow' ? null : (
            <Form.Item
              name="speedLimitKph"
              label="Ограничение скорости"
              rules={[{ required: true, message: 'Укажите ограничение' }]}
              extra="Внутри зоны самокат автоматически замедляется. Если зоны пересекаются, действует самое строгое ограничение."
            >
              <Select
                options={SPEED_LIMIT_OPTIONS.map((kph) => ({
                  value: kph,
                  label: `${String(kph)} км/ч`,
                }))}
              />
            </Form.Item>
          )}
          {draft === null ? null : (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Многоугольник: {draft.coordinates[0]?.length ?? 0} точек
            </Typography.Text>
          )}
        </Form>
      </Modal>
    </Row>
  );
}

/**
 * A scooter on the editor map. Stranded ones get a red ring rather than a
 * different fill, so status stays readable and "outside" reads as an overlay
 * on top of it rather than a seventh status.
 */
function VehicleDot({
  vehicle,
  stranded,
}: {
  vehicle: AdminVehicle;
  stranded: boolean;
}): React.ReactElement {
  return (
    <CircleMarker
      center={[vehicle.location.lat, vehicle.location.lon]}
      radius={stranded ? 6 : 4}
      pathOptions={{
        color: stranded ? SEVERITY_META.alarm.colour : '#ffffff',
        weight: stranded ? 2 : 1,
        fillColor: VEHICLE_STATUS_META[vehicle.status].colour,
        fillOpacity: 0.9,
      }}
    >
      <Tooltip>{vehicle.qrCode}</Tooltip>
    </CircleMarker>
  );
}

/**
 * Wires leaflet-draw's polygon tools into react-leaflet.
 *
 * leaflet-draw predates react-leaflet's component model and mutates the map
 * imperatively, so it is attached in an effect rather than rendered. Existing
 * zones are drawn into its feature group (tagged with their zone id) so the
 * edit tool can drag their vertices; saving fires EDITED, which PATCHes each
 * moved zone.
 *
 * `showArea` stays off deliberately: leaflet-draw 1.0.4's readableArea has an
 * implicit-global assignment that throws in strict-mode ESM the moment a
 * third vertex gives the ring a non-zero area — killing the mouse handler and
 * capping every polygon at 3 points.
 */
function DrawControl({
  zones,
  highlighted,
  onDrawn,
  onEdited,
}: {
  zones: Zone[];
  highlighted: string | null;
  onDrawn: (polygon: GeoPolygon) => void;
  onEdited: (zoneId: string, polygon: GeoPolygon) => void;
}): null {
  const map = useMap();
  const groupRef = useRef<L.FeatureGroup | null>(null);
  const drawnCallback = useRef(onDrawn);
  drawnCallback.current = onDrawn;
  const editedCallback = useRef(onEdited);
  editedCallback.current = onEdited;

  useEffect(() => {
    const drawnItems = new L.FeatureGroup();
    groupRef.current = drawnItems;
    map.addLayer(drawnItems);

    const control = new L.Control.Draw({
      position: 'topleft',
      draw: {
        polygon: { allowIntersection: false },
        polyline: false,
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: false,
      },
      edit: { featureGroup: drawnItems, remove: false },
    });
    map.addControl(control);

    const handleCreated = (event: L.LeafletEvent): void => {
      const layer = (event as L.DrawEvents.Created).layer;
      if (!(layer instanceof L.Polygon)) return;
      const ring = closedRing(layer);
      if (ring === null) return;
      drawnCallback.current({ type: 'Polygon', coordinates: [ring] });
      // The saved zone re-renders from server state, so drop the scratch layer.
      drawnItems.clearLayers();
    };

    const handleEdited = (event: L.LeafletEvent): void => {
      (event as L.DrawEvents.Edited).layers.eachLayer((layer) => {
        const zoneId = (layer as { zoneId?: string }).zoneId;
        if (zoneId === undefined || !(layer instanceof L.Polygon)) return;
        const ring = closedRing(layer);
        if (ring === null) return;
        editedCallback.current(zoneId, { type: 'Polygon', coordinates: [ring] });
      });
    };

    map.on(L.Draw.Event.CREATED, handleCreated);
    map.on(L.Draw.Event.EDITED, handleEdited);

    return () => {
      map.off(L.Draw.Event.CREATED, handleCreated);
      map.off(L.Draw.Event.EDITED, handleEdited);
      map.removeControl(control);
      map.removeLayer(drawnItems);
      groupRef.current = null;
    };
  }, [map]);

  // Mirror server zones into the editable feature group.
  useEffect(() => {
    const group = groupRef.current;
    if (group === null) return;
    group.clearLayers();

    for (const zone of zones) {
      const ring = zone.geom.coordinates[0];
      if (ring === undefined || ring.length < 4) continue;
      // Drop GeoJSON's closing point — Leaflet keeps rings open, and the
      // duplicate would render an extra drag handle on top of the first.
      const positions = ring.slice(0, -1).map(([lon, lat]) => [lat, lon] as [number, number]);
      const layer = L.polygon(positions, styleFor(zone, false));
      (layer as unknown as { zoneId: string }).zoneId = zone.id;
      layer.bindTooltip(zone.name);
      group.addLayer(layer);
    }
  }, [zones]);

  // Restyle on hover rather than rebuilding the group: clearing and re-adding
  // layers would drop any edit handles the operator currently has open.
  useEffect(() => {
    const group = groupRef.current;
    if (group === null) return;

    group.eachLayer((layer) => {
      const zoneId = (layer as { zoneId?: string }).zoneId;
      if (zoneId === undefined || !(layer instanceof L.Polygon)) return;
      const zone = zones.find((item) => item.id === zoneId);
      if (zone === undefined) return;
      layer.setStyle(styleFor(zone, zoneId === highlighted));
    });
  }, [highlighted, zones]);

  return null;
}

function styleFor(zone: Zone, highlighted: boolean): L.PathOptions {
  const colour = ZONE_KIND_META[zone.kind]?.colour ?? '#1677ff';
  const base = zone.kind === 'service' ? 0.04 : 0.18;

  return {
    color: colour,
    weight: highlighted ? 4 : zone.kind === 'service' ? 1 : 2,
    fillOpacity: highlighted ? base + 0.16 : base,
    dashArray: zone.kind === 'forbidden' ? '6 4' : undefined,
  };
}

/** Outer ring of a drawn polygon as a closed GeoJSON ring, or null if degenerate. */
function closedRing(layer: L.Polygon): [number, number][] | null {
  const latLngs = layer.getLatLngs()[0];
  if (!Array.isArray(latLngs)) return null;

  const ring = (latLngs as L.LatLng[]).map(
    (point) => [round6(point.lng), round6(point.lat)] as [number, number],
  );
  const first = ring[0];
  if (first === undefined || ring.length < 3) return null;
  // GeoJSON requires a closed ring; Leaflet leaves it open.
  ring.push([first[0], first[1]]);
  return ring;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
