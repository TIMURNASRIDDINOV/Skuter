import { Descriptions, Drawer, Progress, Space, Typography, theme } from 'antd';
import type { AdminVehicle, Zone } from '@scoot/shared';
import { LOW_BATTERY_THRESHOLD_PCT } from '@scoot/shared';
import type { Anomaly } from '../lib/anomalies.js';
import { formatDateTime, formatRelative } from '../lib/format.js';
import { SEVERITY_META, VehicleStatusTag } from './status.js';
import { FleetMap } from './FleetMap.js';

/**
 * One vehicle in full, in a drawer rather than a route.
 *
 * A drawer keeps the table behind it — an operator working through a list of
 * problems does not lose their place, their filter or their scroll position to
 * look at one scooter. It also slides rather than pops, which is the one thing
 * the brief asks of an opening panel.
 */
export function VehicleDrawer({
  vehicle,
  anomalies,
  zones,
  onClose,
}: {
  vehicle: AdminVehicle | null;
  anomalies: readonly Anomaly[];
  zones: readonly Zone[];
  onClose: () => void;
}): React.ReactElement {
  const { token } = theme.useToken();

  return (
    <Drawer
      open={vehicle !== null}
      onClose={onClose}
      width={520}
      destroyOnHidden
      title={
        vehicle === null ? null : (
          <Space size={10}>
            <Typography.Text strong style={{ fontFamily: 'monospace', fontSize: 15 }}>
              {vehicle.qrCode}
            </Typography.Text>
            <VehicleStatusTag status={vehicle.status} />
          </Space>
        )
      }
    >
      {vehicle === null ? null : (
        <>
          {anomalies.length > 0 ? (
            <div
              style={{
                marginBottom: 14,
                padding: '8px 10px',
                borderRadius: token.borderRadius,
                background: token.colorErrorBg,
                border: `1px solid ${token.colorErrorBorder}`,
              }}
            >
              {anomalies.map((anomaly) => (
                <div key={anomaly.id}>
                  <Space size={8}>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        display: 'inline-block',
                        background: SEVERITY_META[anomaly.severity].colour,
                      }}
                    />
                    <Typography.Text>{anomaly.detail}</Typography.Text>
                  </Space>
                </div>
              ))}
            </div>
          ) : null}

          <FleetMap
            vehicles={[vehicle]}
            zones={[...zones]}
            height={220}
            center={vehicle.location}
            zoom={15}
          />

          <Descriptions
            size="small"
            column={1}
            bordered
            style={{ marginTop: 14 }}
            styles={{ label: { width: 150 } }}
            items={[
              {
                key: 'battery',
                label: 'Заряд',
                children: (
                  <Progress
                    percent={vehicle.batteryPct}
                    size="small"
                    strokeColor={
                      vehicle.batteryPct <= LOW_BATTERY_THRESHOLD_PCT
                        ? token.colorWarning
                        : token.colorSuccess
                    }
                    format={(value) => `${String(value ?? 0)}%`}
                  />
                ),
              },
              {
                key: 'range',
                label: 'Запас хода',
                children: `${(vehicle.rangeM / 1000).toFixed(1)} км`,
              },
              { key: 'model', label: 'Модель', children: vehicle.model },
              {
                key: 'imei',
                label: 'IMEI',
                children: (
                  <Typography.Text copyable style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {vehicle.imei}
                  </Typography.Text>
                ),
              },
              {
                key: 'location',
                label: 'Координаты',
                children: (
                  <Typography.Text
                    copyable={{ text: `${vehicle.location.lat}, ${vehicle.location.lon}` }}
                    style={{ fontFamily: 'monospace', fontSize: 12 }}
                  >
                    {vehicle.location.lat.toFixed(5)}, {vehicle.location.lon.toFixed(5)}
                  </Typography.Text>
                ),
              },
              {
                key: 'lastSeen',
                label: 'На связи',
                children: (
                  <Space size={6}>
                    <span>{formatRelative(vehicle.lastSeenAt)}</span>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {formatDateTime(vehicle.lastSeenAt)}
                    </Typography.Text>
                  </Space>
                ),
              },
            ]}
          />
        </>
      )}
    </Drawer>
  );
}
