import { Button, Descriptions, Drawer, Popconfirm, Space, Typography, theme } from 'antd';
import { StopOutlined } from '@ant-design/icons';
import type { Ride } from '@scoot/shared';
import { formatDateTime, formatDistance, formatDuration } from '../lib/format.js';
import { formatSom } from '../lib/money.js';
import { RideStatusTag } from './status.js';
import { FleetMap } from './FleetMap.js';

export interface RideRow extends Ride {
  vehicleQrCode: string;
  userPhone: string | null;
}

/**
 * One ride in full, with its route drawn.
 *
 * The list previously reduced `path` to "N точек", which is the least useful
 * thing that can be done with a travelled route. Here it is the main content:
 * where the scooter actually went is the question an operator is asking when
 * they open a ride at all.
 */
export function RideDrawer({
  ride,
  liveDurationS,
  isEnding,
  onForceEnd,
  onClose,
}: {
  ride: RideRow | null;
  liveDurationS: number | null;
  isEnding: boolean;
  onForceEnd: (ride: RideRow) => void;
  onClose: () => void;
}): React.ReactElement {
  const { token } = theme.useToken();
  const durationS = liveDurationS ?? ride?.durationS ?? 0;

  return (
    <Drawer
      open={ride !== null}
      onClose={onClose}
      width={520}
      destroyOnHidden
      title={
        ride === null ? null : (
          <Space size={10}>
            <Typography.Text strong style={{ fontFamily: 'monospace', fontSize: 15 }}>
              {ride.vehicleQrCode}
            </Typography.Text>
            <RideStatusTag status={ride.status} />
          </Space>
        )
      }
      footer={
        ride === null || ride.status !== 'active' ? null : (
          <Popconfirm
            title="Завершить поездку?"
            description="Поездка будет остановлена там, где находится самокат. Пользователь оплатит использованное время."
            okText="Завершить"
            cancelText="Отмена"
            okButtonProps={{ danger: true }}
            onConfirm={() => {
              onForceEnd(ride);
            }}
          >
            <Button danger icon={<StopOutlined />} loading={isEnding} block>
              Завершить поездку
            </Button>
          </Popconfirm>
        )
      }
    >
      {ride === null ? null : (
        <>
          {ride.path === null ? (
            <div
              style={{
                padding: '32px 0',
                textAlign: 'center',
                background: token.colorFillQuaternary,
                borderRadius: token.borderRadius,
              }}
            >
              <Typography.Text type="secondary">
                Маршрут появится, когда самокат проедет первые метры
              </Typography.Text>
            </div>
          ) : (
            <FleetMap vehicles={[]} showZones={false} height={260} path={ride.path} />
          )}

          <Descriptions
            size="small"
            column={1}
            bordered
            style={{ marginTop: 14 }}
            styles={{ label: { width: 150 } }}
            items={[
              {
                key: 'user',
                label: 'Пользователь',
                children: ride.userPhone ?? 'Telegram',
              },
              {
                key: 'started',
                label: 'Начало',
                children: formatDateTime(ride.startedAt),
              },
              {
                key: 'ended',
                label: 'Завершение',
                children: ride.endedAt === null ? 'ещё едет' : formatDateTime(ride.endedAt),
              },
              {
                key: 'duration',
                label: 'Длительность',
                children: (
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatDuration(durationS)}
                  </span>
                ),
              },
              {
                key: 'distance',
                label: 'Расстояние',
                children: formatDistance(ride.distanceM),
              },
              {
                key: 'cost',
                label: 'Стоимость',
                children: (
                  <Typography.Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatSom(ride.cost)}
                    {ride.status === 'active' ? (
                      <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
                        {' '}
                        — начисляется
                      </Typography.Text>
                    ) : null}
                  </Typography.Text>
                ),
              },
              {
                key: 'points',
                label: 'Точек трека',
                children: ride.path === null ? '—' : ride.path.coordinates.length,
              },
            ]}
          />
        </>
      )}
    </Drawer>
  );
}
