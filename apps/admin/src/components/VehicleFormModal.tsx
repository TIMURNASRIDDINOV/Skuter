import { useCallback, useEffect, useState } from 'react';
import {
  App as AntApp,
  AutoComplete,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Slider,
  Switch,
  Typography,
} from 'antd';
import { CircleMarker, MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import {
  BUKHARA_MAP_CENTER,
  VEHICLE_MODELS,
  type AdminVehicle,
  type LatLon,
  type VehicleStatus,
} from '@ozothunder/shared';
import { apiFetch } from '../lib/api.js';
import { VEHICLE_STATUS_META } from './status.js';
import { MapAutoSize } from './MapAutoSize.js';
import 'leaflet/dist/leaflet.css';

interface VehicleFormValues {
  qrCode: string;
  imei: string;
  model: string;
  status: VehicleStatus;
  batteryPct: number;
  simulated: boolean;
}

/**
 * Adding a real scooter to the fleet, or correcting one already in it.
 *
 * The fields are ordered the way an operator fills them: the two numbers
 * printed on the hardware, what it is, then what state it is in and where it
 * is standing. Position is a pin dropped on the map rather than two decimal
 * boxes — nobody knows a courtyard's latitude — but the boxes are there beside
 * it, because a coordinate copied from somewhere else has to be typeable.
 */
export function VehicleFormModal({
  open,
  vehicle,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Null adds a scooter; a vehicle edits that one. */
  vehicle: AdminVehicle | null;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<VehicleFormValues>();
  const [position, setPosition] = useState<LatLon>(BUKHARA_MAP_CENTER);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (vehicle === null) {
      form.setFieldsValue({
        qrCode: '',
        imei: '',
        model: VEHICLE_MODELS[0],
        status: 'available',
        batteryPct: 100,
        simulated: false,
      });
      setPosition(BUKHARA_MAP_CENTER);
    } else {
      form.setFieldsValue({
        qrCode: vehicle.qrCode,
        imei: vehicle.imei,
        model: vehicle.model,
        status: vehicle.status,
        batteryPct: vehicle.batteryPct,
        simulated: vehicle.simulated,
      });
      setPosition(vehicle.location);
    }
  }, [form, open, vehicle]);

  const save = useCallback(
    async (values: VehicleFormValues) => {
      setSaving(true);
      try {
        const body = JSON.stringify({ ...values, location: position });
        if (vehicle === null) {
          await apiFetch<AdminVehicle>('/admin/vehicles', { method: 'POST', body });
          message.success(`Самокат ${values.qrCode} добавлен`);
        } else {
          await apiFetch<AdminVehicle>(`/admin/vehicles/${vehicle.id}`, { method: 'PATCH', body });
          message.success(`Самокат ${values.qrCode} обновлён`);
        }
        onSaved();
        onClose();
      } catch (cause: unknown) {
        message.error(cause instanceof Error ? cause.message : 'Не удалось сохранить самокат');
      } finally {
        setSaving(false);
      }
    },
    [message, onClose, onSaved, position, vehicle],
  );

  return (
    <Modal
      open={open}
      title={vehicle === null ? 'Новый самокат' : `Самокат ${vehicle.qrCode}`}
      okText="Сохранить"
      cancelText="Отмена"
      confirmLoading={saving}
      onCancel={onClose}
      onOk={() => {
        form.submit();
      }}
      destroyOnHidden
      width={640}
    >
      <Form form={form} layout="vertical" onFinish={(values) => void save(values)}>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item
              name="qrCode"
              label="QR-код"
              extra="Как на наклейке: 9 цифр"
              rules={[{ required: true, pattern: /^\d{9}$/, message: 'Девять цифр, например 000000042' }]}
            >
              <Input placeholder="000000042" autoComplete="off" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="imei"
              label="IMEI"
              extra="15 цифр с наклейки контроллера"
              rules={[{ required: true, pattern: /^\d{15}$/, message: 'Пятнадцать цифр' }]}
            >
              <Input placeholder="863512345678901" autoComplete="off" />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="model" label="Модель" rules={[{ required: true, message: 'Укажите модель' }]}>
              {/* Suggestions, not a closed list — the next crate to arrive will
                  not have asked this file first. */}
              <AutoComplete
                options={VEHICLE_MODELS.map((model) => ({ value: model }))}
                placeholder="Ninebot Max G30"
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="status" label="Статус">
              <Select
                options={Object.entries(VEHICLE_STATUS_META).map(([value, meta]) => ({
                  value,
                  label: meta.label,
                }))}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="batteryPct" label="Заряд, %">
          <Slider min={0} max={100} marks={{ 0: '0', 20: '20', 50: '50', 100: '100' }} />
        </Form.Item>

        <Form.Item
          name="simulated"
          label="Симулировать"
          valuePropName="checked"
          extra="Симулятор будет катать этот самокат и разряжать батарею. Для реального самоката — выключено: заряд и координаты приходят от него самого."
        >
          <Switch />
        </Form.Item>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Положение — нажмите на карту
        </Typography.Text>
        <div style={{ height: 240, marginTop: 8, borderRadius: 4, overflow: 'hidden' }}>
          <MapContainer
            center={[position.lat, position.lon]}
            zoom={14}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              attribution="&copy; OpenStreetMap, &copy; CARTO"
            />
            <MapAutoSize />
            <PickPosition onPick={setPosition} />
            <CircleMarker
              center={[position.lat, position.lon]}
              radius={8}
              pathOptions={{ color: '#1677ff', fillColor: '#1677ff', fillOpacity: 0.9 }}
            />
          </MapContainer>
        </div>

        <Row gutter={12} style={{ marginTop: 12 }}>
          <Col span={12}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Широта
            </Typography.Text>
            <InputNumber
              value={position.lat}
              step={0.0001}
              precision={6}
              style={{ width: '100%' }}
              onChange={(lat) => {
                if (typeof lat === 'number') setPosition((p) => ({ ...p, lat }));
              }}
            />
          </Col>
          <Col span={12}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Долгота
            </Typography.Text>
            <InputNumber
              value={position.lon}
              step={0.0001}
              precision={6}
              style={{ width: '100%' }}
              onChange={(lon) => {
                if (typeof lon === 'number') setPosition((p) => ({ ...p, lon }));
              }}
            />
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}

/** Leaflet click handling has to live inside the map, hence a child component. */
function PickPosition({ onPick }: { onPick: (position: LatLon) => void }): null {
  useMapEvents({
    click(event) {
      onPick({ lat: event.latlng.lat, lon: event.latlng.lng });
    },
  });
  return null;
}
