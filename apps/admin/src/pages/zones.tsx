import { useCallback, useEffect, useRef, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Col,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-draw';
import { TASHKENT_MAP_CENTER, type GeoPolygon, type Zone, type ZoneKind } from '@scoot/shared';
import { apiFetch, type ListResponse } from '../lib/api.js';
import { ZONE_KIND_META } from '../components/status.js';
import { ErrorState, TableSkeleton } from '../components/states.js';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';

/**
 * Zone editor — demo step 7. Draw a polygon on the map, name it, save, and it
 * is immediately live for the rider app's next refresh.
 */
export function ZonesPage(): React.ReactElement {
  const { message } = AntApp.useApp();
  const [zones, setZones] = useState<Zone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<GeoPolygon | null>(null);
  const [form] = Form.useForm<{ name: string; kind: ZoneKind }>();

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

  const save = useCallback(
    async (values: { name: string; kind: ZoneKind }) => {
      if (draft === null) return;
      try {
        await apiFetch<Zone>('/admin/zones', {
          method: 'POST',
          body: JSON.stringify({ name: values.name, kind: values.kind, geom: draft }),
        });
        message.success('Зона сохранена — обновите приложение, чтобы увидеть её');
        setDraft(null);
        form.resetFields();
        load();
      } catch (cause: unknown) {
        message.error(cause instanceof Error ? cause.message : 'Не удалось сохранить зону');
      }
    },
    [draft, form, load, message],
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

  if (error !== null) return <ErrorState message={error} onRetry={load} />;

  return (
    <Row gutter={[12, 12]}>
      <Col xs={24} xl={17}>
        <Card
          size="small"
          title="Редактор зон"
          extra={
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Выберите инструмент многоугольника слева и обведите область
            </Typography.Text>
          }
        >
          <MapContainer
            center={[TASHKENT_MAP_CENTER.lat, TASHKENT_MAP_CENTER.lon]}
            zoom={11}
            style={{ height: 560, width: '100%', borderRadius: 6 }}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap"
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            />

            <DrawControl
              zones={zones}
              onDrawn={setDraft}
              onEdited={(id, geom) => {
                void updateGeometry(id, geom);
              }}
            />
          </MapContainer>
        </Card>
      </Col>

      <Col xs={24} xl={7}>
        <Card size="small" title={`Зоны — ${String(zones.length)}`}>
          {isLoading ? (
            <TableSkeleton rows={6} />
          ) : (
            <List
              size="small"
              dataSource={zones}
              locale={{ emptyText: 'Зон пока нет' }}
              renderItem={(zone) => (
                <List.Item
                  actions={[
                    <Popconfirm
                      key="delete"
                      title="Удалить зону?"
                      description="Действие нельзя отменить."
                      okText="Удалить"
                      cancelText="Отмена"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => {
                        void remove(zone.id);
                      }}
                    >
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>,
                  ]}
                >
                  <Space direction="vertical" size={0}>
                    <Typography.Text>{zone.name}</Typography.Text>
                    <Tag
                      color={ZONE_KIND_META[zone.kind]?.colour}
                      style={{ marginTop: 2 }}
                    >
                      {ZONE_KIND_META[zone.kind]?.label ?? zone.kind}
                    </Tag>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </Card>
      </Col>

      <Modal
        open={draft !== null}
        title="Новая зона"
        okText="Сохранить"
        cancelText="Отмена"
        onCancel={() => {
          setDraft(null);
          form.resetFields();
        }}
        onOk={() => {
          void form.submit();
        }}
      >
        <Form form={form} layout="vertical" onFinish={save} initialValues={{ kind: 'parking' }}>
          <Form.Item
            name="name"
            label="Название"
            rules={[{ required: true, message: 'Укажите название' }]}
          >
            <Input placeholder="Например: Парковка у метро Пушкина" />
          </Form.Item>
          <Form.Item name="kind" label="Тип" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'parking', label: 'Парковка' },
                { value: 'forbidden', label: 'Запрещённая зона' },
                { value: 'service', label: 'Зона обслуживания' },
              ]}
            />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {draft === null
              ? null
              : `Многоугольник: ${String(draft.coordinates[0]?.length ?? 0)} точек`}
          </Typography.Text>
        </Form>
      </Modal>
    </Row>
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
  onDrawn,
  onEdited,
}: {
  zones: Zone[];
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
      const layer = L.polygon(positions, {
        color: ZONE_KIND_META[zone.kind]?.colour ?? '#1677ff',
        weight: zone.kind === 'service' ? 1 : 2,
        fillOpacity: zone.kind === 'service' ? 0.04 : 0.18,
        dashArray: zone.kind === 'forbidden' ? '6 4' : undefined,
      });
      (layer as unknown as { zoneId: string }).zoneId = zone.id;
      layer.bindTooltip(zone.name);
      group.addLayer(layer);
    }
  }, [zones]);

  return null;
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
