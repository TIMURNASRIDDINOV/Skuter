import { useMemo, useState } from 'react';
import { Card, Input, Progress, Segmented, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { AdminVehicle, VehicleStatus } from '@scoot/shared';
import { useLiveFleet } from '../lib/useLiveFleet.js';
import { formatRelative } from '../lib/format.js';
import { VEHICLE_STATUS_META, VehicleStatusTag } from '../components/status.js';
import { EmptyState, ErrorState, TableSkeleton } from '../components/states.js';

/** Vehicles table, live from the same SSE stream as the map. */
export function VehiclesPage(): React.ReactElement {
  const { vehicles, isLoading, error, refetch } = useLiveFleet();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<VehicleStatus | 'all'>('all');

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return vehicles.filter((vehicle) => {
      if (statusFilter !== 'all' && vehicle.status !== statusFilter) return false;
      if (needle === '') return true;
      return (
        vehicle.qrCode.toLowerCase().includes(needle) ||
        vehicle.model.toLowerCase().includes(needle) ||
        vehicle.imei.includes(needle)
      );
    });
  }, [vehicles, search, statusFilter]);

  const columns: ColumnsType<AdminVehicle> = [
    {
      title: 'Код',
      dataIndex: 'qrCode',
      width: 130,
      sorter: (a, b) => a.qrCode.localeCompare(b.qrCode),
      render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
    },
    { title: 'Модель', dataIndex: 'model', width: 160, ellipsis: true },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 150,
      render: (status: VehicleStatus) => <VehicleStatusTag status={status} />,
    },
    {
      title: 'Заряд',
      dataIndex: 'batteryPct',
      width: 150,
      sorter: (a, b) => a.batteryPct - b.batteryPct,
      render: (pct: number) => (
        <Progress
          percent={pct}
          size="small"
          strokeColor={pct < 20 ? '#faad14' : pct < 50 ? '#1677ff' : '#52c41a'}
          format={(value) => `${String(value ?? 0)}%`}
        />
      ),
    },
    {
      title: 'Запас хода',
      dataIndex: 'rangeM',
      width: 110,
      render: (metres: number) => `${(metres / 1000).toFixed(1)} км`,
    },
    {
      title: 'Координаты',
      key: 'location',
      width: 190,
      render: (_, vehicle) => (
        <Typography.Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {vehicle.location.lat.toFixed(5)}, {vehicle.location.lon.toFixed(5)}
        </Typography.Text>
      ),
    },
    { title: 'IMEI', dataIndex: 'imei', width: 150, ellipsis: true },
    {
      title: 'На связи',
      dataIndex: 'lastSeenAt',
      width: 130,
      render: (iso: string) => (
        <Typography.Text type="secondary">{formatRelative(iso)}</Typography.Text>
      ),
    },
  ];

  if (error !== null) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <Card
      size="small"
      title={`Самокаты — ${String(vehicles.length)}`}
      extra={
        <Space>
          <Segmented
            size="small"
            value={statusFilter}
            onChange={(value) => {
              setStatusFilter(value as VehicleStatus | 'all');
            }}
            options={[
              { label: 'Все', value: 'all' },
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
            style={{ width: 220 }}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />
        </Space>
      }
    >
      {isLoading ? (
        <TableSkeleton rows={10} />
      ) : filtered.length === 0 ? (
        <EmptyState
          description={
            vehicles.length === 0
              ? 'Парк пуст — запустите pnpm db:seed'
              : 'Ничего не найдено по этому фильтру'
          }
        />
      ) : (
        <Table
          rowKey="id"
          size="small"
          dataSource={filtered}
          columns={columns}
          pagination={{ pageSize: 20, showSizeChanger: true, size: 'small' }}
          scroll={{ x: 1150 }}
        />
      )}
    </Card>
  );
}
