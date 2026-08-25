import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Input,
  Popconfirm,
  Progress,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
  theme,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { AdminVehicle, Ride, VehicleStatus, Zone } from '@ozothunder/shared';
import { LOW_BATTERY_THRESHOLD_PCT } from '@ozothunder/shared';
import { useLiveFleet } from '../lib/useLiveFleet.js';
import { apiFetch, type ListResponse } from '../lib/api.js';
import { useServerEvents } from '../lib/events.js';
import { formatAgo } from '../lib/format.js';
import {
  DEFAULT_THRESHOLDS,
  deriveAnomalies,
  type Anomaly,
} from '../lib/anomalies.js';
import {
  SEVERITY_META,
  VEHICLE_STATUS_META,
  VehicleStatusTag,
  type Severity,
} from '../components/status.js';
import { useRecentlyChanged } from '../components/motion.js';
import { useAdminSession } from '../providers/session.js';
import { VehicleDrawer } from '../components/VehicleDrawer.js';
import { VehicleFormModal } from '../components/VehicleFormModal.js';
import { EmptyState, ErrorState, TableSkeleton } from '../components/states.js';

type ActiveRide = Ride & { vehicleQrCode: string };

/** `all` and `attention` sit alongside the real statuses as pseudo-filters. */
type Filter = VehicleStatus | 'all' | 'attention';

const vehicleId = (vehicle: AdminVehicle): string => vehicle.id;
// Battery and position move every tick; only a status change should flash.
const vehicleSignature = (vehicle: AdminVehicle): string => vehicle.status;

/**
 * The fleet, live from the same SSE stream as the map.
 *
 * Problems come first: the toolbar leads with how many vehicles need something
 * doing, and each row carries its own faults. The reference panel's equivalent
 * screen opens with roughly 700px of filter chips and no data above the fold
 * (docs/reference-review.md §1.5) — this one opens on the table.
 */
export function VehiclesPage(): React.ReactElement {
  const { vehicles, isLoading, error, refetch } = useLiveFleet();
  const [zones, setZones] = useState<Zone[]>([]);
  const [activeRides, setActiveRides] = useState<ActiveRide[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<AdminVehicle | null>(null);
  const [editing, setEditing] = useState<AdminVehicle | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const { message } = AntApp.useApp();
  const session = useAdminSession();
  const canManage = session.can('vehicles', 'manage');

  const removeVehicle = useCallback(
    async (vehicle: AdminVehicle) => {
      try {
        await apiFetch(`/admin/vehicles/${vehicle.id}`, { method: 'DELETE' });
        message.success(`Самокат ${vehicle.qrCode} удалён`);
        refetch();
      } catch (cause: unknown) {
        message.error(cause instanceof Error ? cause.message : 'Не удалось удалить самокат');
      }
    },
    [message, refetch],
  );
  const { token } = theme.useToken();

  const loadContext = useCallback(() => {
    Promise.all([
      apiFetch<ListResponse<Zone>>('/admin/zones'),
      apiFetch<ListResponse<ActiveRide>>('/admin/rides?status=active'),
    ])
      .then(([nextZones, nextRides]) => {
        setZones(nextZones.items);
        setActiveRides(nextRides.items);
      })
      .catch(() => {
        // The table stands on its own without zones; losing them only costs
        // the out-of-zone flag, so this must not blank the screen.
      });
  }, []);

  useEffect(loadContext, [loadContext]);
  useServerEvents(loadContext, ['ride.started', 'ride.ended']);

  const anomalies = useMemo(
    () =>
      deriveAnomalies({ vehicles, zones, activeRides, thresholds: DEFAULT_THRESHOLDS }),
    [vehicles, zones, activeRides],
  );

  const byVehicle = useMemo(() => {
    const map = new Map<string, Anomaly[]>();
    for (const anomaly of anomalies) {
      const bucket = map.get(anomaly.vehicleId);
      if (bucket === undefined) map.set(anomaly.vehicleId, [anomaly]);
      else bucket.push(anomaly);
    }
    return map;
  }, [anomalies]);

  const attentionCount = byVehicle.size;
  const flashing = useRecentlyChanged(vehicles, vehicleId, vehicleSignature);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      if (filter === 'attention' && !byVehicle.has(vehicle.id)) return false;
      if (filter !== 'all' && filter !== 'attention' && vehicle.status !== filter) return false;
      if (needle === '') return true;
      return (
        vehicle.qrCode.toLowerCase().includes(needle) ||
        vehicle.model.toLowerCase().includes(needle) ||
        vehicle.imei.includes(needle)
      );
    });
  }, [vehicles, search, filter, byVehicle]);

  const columns: ColumnsType<AdminVehicle> = [
    {
      title: 'Самокат',
      dataIndex: 'qrCode',
      width: 190,
      sorter: (a, b) => a.qrCode.localeCompare(b.qrCode),
      defaultSortOrder: 'ascend',
      // Code and model as one cell with a hierarchy, rather than two columns
      // of equal weight — the code is what an operator reads, the model is
      // context they only need once they have found the row.
      render: (code: string, vehicle) => (
        <Space size={8}>
          <SeverityDot severity={worstSeverity(byVehicle.get(vehicle.id))} />
          <span>
            <Typography.Text strong style={{ fontFamily: 'monospace' }}>
              {code}
            </Typography.Text>
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {vehicle.model}
            </Typography.Text>
          </span>
        </Space>
      ),
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 140,
      render: (status: VehicleStatus) => <VehicleStatusTag status={status} />,
    },
    {
      title: 'Проблемы',
      key: 'problems',
      render: (_, vehicle) => {
        const found = byVehicle.get(vehicle.id);
        if (found === undefined) {
          return (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              —
            </Typography.Text>
          );
        }
        return (
          <Space size={4} wrap>
            {found.map((anomaly) => (
              <Typography.Text
                key={anomaly.id}
                style={{ fontSize: 12, color: SEVERITY_META[anomaly.severity].colour }}
              >
                {anomaly.detail}
              </Typography.Text>
            ))}
          </Space>
        );
      },
    },
    {
      title: 'Заряд',
      dataIndex: 'batteryPct',
      width: 130,
      sorter: (a, b) => a.batteryPct - b.batteryPct,
      render: (pct: number) => (
        <Progress
          percent={pct}
          size="small"
          strokeColor={
            pct <= LOW_BATTERY_THRESHOLD_PCT
              ? token.colorWarning
              : pct < 50
                ? token.colorPrimary
                : token.colorSuccess
          }
          format={(value) => `${String(value ?? 0)}%`}
        />
      ),
    },
    {
      title: 'Запас хода',
      dataIndex: 'rangeM',
      width: 105,
      sorter: (a, b) => a.rangeM - b.rangeM,
      render: (metres: number) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {(metres / 1000).toFixed(1)} км
        </span>
      ),
    },
    {
      title: 'На связи',
      dataIndex: 'lastSeenAt',
      width: 100,
      align: 'right',
      sorter: (a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt),
      render: (iso: string) => (
        <Typography.Text type="secondary" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatAgo(iso)}
        </Typography.Text>
      ),
    },
    {
      title: 'Симуляция',
      dataIndex: 'simulated',
      width: 110,
      render: (simulated: boolean) =>
        simulated ? <Tag color="purple">Симулятор</Tag> : <Tag>Реальный</Tag>,
    },
    ...(canManage
      ? [
          {
            title: '',
            key: 'actions',
            width: 80,
            // The row itself opens the drawer, so these must not bubble into it.
            render: (_: unknown, vehicle: AdminVehicle) => (
              <Space size={0} onClick={(event) => { event.stopPropagation(); }}>
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditing(vehicle);
                    setFormOpen(true);
                  }}
                />
                <Popconfirm
                  title={`Удалить самокат ${vehicle.qrCode}?`}
                  okText="Удалить"
                  okButtonProps={{ danger: true }}
                  cancelText="Отмена"
                  onConfirm={() => void removeVehicle(vehicle)}
                >
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ];

  if (error !== null) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <>
      <Card size="small">
        {/* One row, not the reference panel's 700px filter wall — the table
            has to start above the fold. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            marginBottom: 10,
          }}
        >
          <Typography.Text strong style={{ flex: '0 0 auto' }}>
            Самокаты{' '}
            <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
              {filtered.length === vehicles.length
                ? vehicles.length
                : `${String(filtered.length)} из ${String(vehicles.length)}`}
            </Typography.Text>
          </Typography.Text>

          <Segmented
            size="small"
            value={filter}
            onChange={(value) => {
              setFilter(value as Filter);
            }}
            options={[
              { label: 'Все', value: 'all' },
              {
                label:
                  attentionCount > 0
                    ? `Требует внимания · ${String(attentionCount)}`
                    : 'Требует внимания',
                value: 'attention',
              },
              ...(Object.keys(VEHICLE_STATUS_META) as VehicleStatus[]).map((status) => ({
                label: VEHICLE_STATUS_META[status].label,
                value: status,
              })),
            ]}
          />

          <Input.Search
            size="small"
            allowClear
            placeholder="Код, модель или IMEI"
            style={{ width: 210, marginLeft: 'auto' }}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />

          {canManage ? (
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Добавить
            </Button>
          ) : null}
        </div>

        {isLoading ? (
          <TableSkeleton rows={10} />
        ) : filtered.length === 0 ? (
          <EmptyState
            description={
              vehicles.length === 0
                ? 'Парк пуст — добавьте первый самокат кнопкой «Добавить»'
                : filter === 'attention'
                  ? 'Ничего не требует вмешательства'
                  : 'Ничего не найдено по этому фильтру'
            }
          />
        ) : (
          <Table
            rowKey="id"
            size="small"
            dataSource={filtered}
            columns={columns}
            rowClassName={(vehicle) => (flashing.has(vehicle.id) ? 'fleet-flash' : '')}
            onRow={(vehicle) => ({
              onClick: () => {
                setSelected(vehicle);
              },
              style: { cursor: 'pointer' },
            })}
            pagination={{ pageSize: 20, showSizeChanger: true, size: 'small' }}
            scroll={{ x: 1000 }}
          />
        )}
      </Card>

      <VehicleFormModal
        open={formOpen}
        vehicle={editing}
        onClose={() => {
          setFormOpen(false);
        }}
        onSaved={refetch}
      />

      <VehicleDrawer
        // Read through from live fleet state so the drawer keeps ticking while
        // it is open rather than freezing on the row as it was clicked.
        vehicle={
          selected === null
            ? null
            : (vehicles.find((item) => item.id === selected.id) ?? selected)
        }
        anomalies={selected === null ? [] : (byVehicle.get(selected.id) ?? [])}
        zones={zones}
        onClose={() => {
          setSelected(null);
        }}
      />
    </>
  );
}

function worstSeverity(anomalies: Anomaly[] | undefined): Severity {
  if (anomalies === undefined || anomalies.length === 0) return 'ok';
  return anomalies.some((anomaly) => anomaly.severity === 'alarm') ? 'alarm' : 'watch';
}

function SeverityDot({ severity }: { severity: Severity }): React.ReactElement {
  return (
    <span
      aria-label={SEVERITY_META[severity].label}
      title={SEVERITY_META[severity].label}
      style={{
        width: 7,
        height: 7,
        borderRadius: '50%',
        flex: '0 0 auto',
        display: 'inline-block',
        // An "everything is fine" dot on every healthy row is noise; leave the
        // space so codes stay aligned, but only ink it when it means something.
        background: severity === 'ok' ? 'transparent' : SEVERITY_META[severity].colour,
      }}
    />
  );
}
