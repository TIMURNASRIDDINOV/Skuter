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
import { MapContainer, Polygon, TileLayer, Tooltip, useMap } from 'react-leaflet';
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

            {zones.map((zone) => {
              const positions = zone.geom.coordinates[0]?.map(
                ([lon, lat]) => [lat, lon] as [number, number],
              );
              if (positions === undefined) return null;
              return (
                <Polygon
                  key={zone.id}
                  positions={positions}
                  pathOptions={{
                    color: ZONE_KIND_META[zone.kind]?.colour ?? '#1677ff',
                    weight: zone.kind === 'service' ? 1 : 2,
                    fillOpacity: zone.kind === 'service' ? 0.04 : 0.18,
                    dashArray: zone.kind === 'forbidden' ? '6 4' : undefined,
                  }}
                >
                  <Tooltip>{zone.name}</Tooltip>
                </Polygon>
              );
            })}

            <DrawControl onDrawn={setDraft} />
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
 * Wires leaflet-draw's polygon tool into react-leaflet.
 *
 * leaflet-draw predates react-leaflet's component model and mutates the map
 * imperatively, so it is attached in an effect rather than rendered.
 */
function DrawControl({ onDrawn }: { onDrawn: (polygon: GeoPolygon) => void }): null {
  const map = useMap();
  const callback = useRef(onDrawn);
  callback.current = onDrawn;

  useEffect(() => {
    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    const control = new L.Control.Draw({
      position: 'topleft',
      draw: {
        polygon: { allowIntersection: false, showArea: true },
        polyline: false,
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: false,
      },
      edit: { featureGroup: drawnItems, edit: false, remove: false },
    });
    map.addControl(control);

    const handleCreated = (event: L.LeafletEvent): void => {
      const layer = (event as L.DrawEvents.Created).layer;
      if (!(layer instanceof L.Polygon)) return;

      const latLngs = layer.getLatLngs()[0];
      if (!Array.isArray(latLngs)) return;

      const ring = (latLngs as L.LatLng[]).map(
        (point) => [round6(point.lng), round6(point.lat)] as [number, number],
      );
      const first = ring[0];
      if (first === undefined || ring.length < 3) return;
      // GeoJSON requires a closed ring; Leaflet leaves it open.
      ring.push([first[0], first[1]]);

      callback.current({ type: 'Polygon', coordinates: [ring] });
      // The saved zone re-renders from server state, so drop the scratch layer.
      drawnItems.clearLayers();
    };

    map.on(L.Draw.Event.CREATED, handleCreated);

    return () => {
      map.off(L.Draw.Event.CREATED, handleCreated);
      map.removeControl(control);
      map.removeLayer(drawnItems);
    };
  }, [map]);

  return null;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
