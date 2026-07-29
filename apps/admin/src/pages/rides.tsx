import { useCallback, useEffect, useState } from 'react';
import { App as AntApp, Badge, Button, Card, Popconfirm, Segmented, Space, Table, Typography } from 'antd';
import { StopOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Ride, RideReceipt, RideStatus } from '@scoot/shared';
import { apiFetch, type ListResponse } from '../lib/api.js';
import { useServerEvents } from '../lib/events.js';
import { formatDateTime, formatDistance, formatDuration } from '../lib/format.js';
import { formatSom } from '../lib/money.js';
import { RideStatusTag } from '../components/status.js';
import { EmptyState, ErrorState, TableSkeleton } from '../components/states.js';

interface RideRow extends Ride {
  vehicleQrCode: string;
  userPhone: string | null;
}

/**
 * Live rides table — demo step 3. A ride started on the phone appears here
 * without a refresh, and its duration, distance and cost tick as it runs.
 */
export function RidesPage(): React.ReactElement {
  const { message } = AntApp.useApp();
  const [rides, setRides] = useState<RideRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RideStatus | 'all'>('all');
  const [endingId, setEndingId] = useState<string | null>(null);

  const load = useCallback(() => {
    const query = filter === 'all' ? '' : `?status=${filter}`;
    apiFetch<ListResponse<RideRow>>(`/admin/rides${query}`)
      .then((response) => {
        setRides(response.items);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить поездки');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [filter]);

  useEffect(load, [load]);

  // A ride starting or ending changes which rows exist, so refetch. Progress
  // updates only change values on rows already present, so patch in place.
  useServerEvents(load, ['ride.started', 'ride.ended']);

  useServerEvents(
    useCallback((event) => {
      if (event.type !== 'ride.updated') return;
      setRides((current) =>
        current.map((ride) =>
          ride.id === event.rideId
            ? {
                ...ride,
                distanceM: event.distanceM,
                durationS: event.durationS,
                cost: event.currentCost,
              }
            : ride,
        ),
      );
    }, []),
    ['ride.updated'],
  );

  // The operator's recovery lever for stuck or abandoned rides: settles the
  // ride wherever the scooter is, charging the rider for the time used.
  const forceEnd = useCallback(
    async (ride: RideRow) => {
      setEndingId(ride.id);
      try {
        const receipt = await apiFetch<RideReceipt>(`/admin/rides/${ride.id}/end`, {
          method: 'POST',
        });
        message.success(
          `Поездка ${ride.vehicleQrCode} завершена — ${formatSom(receipt.breakdown.total)}`,
        );
        load();
      } catch (cause: unknown) {
        message.error(cause instanceof Error ? cause.message : 'Не удалось завершить поездку');
      } finally {
        setEndingId(null);
      }
    },
    [load, message],
  );

  const columns: ColumnsType<RideRow> = [
    {
      title: 'Самокат',
      dataIndex: 'vehicleQrCode',
      width: 130,
      render: (value: string, ride) => (
        <Space size={4}>
          {ride.status === 'active' ? <Badge status="processing" /> : null}
          <Typography.Text strong>{value}</Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Пользователь',
      dataIndex: 'userPhone',
      width: 150,
      render: (value: string | null) => value ?? 'Telegram',
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 120,
      render: (status: string) => <RideStatusTag status={status} />,
    },
    {
      title: 'Начало',
      dataIndex: 'startedAt',
      width: 150,
      sorter: (a, b) => a.startedAt.localeCompare(b.startedAt),
      defaultSortOrder: 'descend',
      render: (iso: string) => formatDateTime(iso),
    },
    {
      title: 'Длительность',
      dataIndex: 'durationS',
      width: 120,
      render: (seconds: number) => (
        <Typography.Text style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatDuration(seconds)}
        </Typography.Text>
      ),
    },
    {
      title: 'Расстояние',
      dataIndex: 'distanceM',
      width: 110,
      render: (metres: number) => formatDistance(metres),
    },
    {
      title: 'Стоимость',
      dataIndex: 'cost',
      width: 130,
      align: 'right',
      render: (tiyin: number, ride) => (
        <Typography.Text
          strong={ride.status === 'active'}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {formatSom(tiyin)}
        </Typography.Text>
      ),
    },
    {
      title: 'Трек',
      key: 'path',
      width: 90,
      render: (_, ride) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {ride.path === null ? '—' : `${String(ride.path.coordinates.length)} точек`}
        </Typography.Text>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 130,
      render: (_, ride) =>
        ride.status === 'active' ? (
          <Popconfirm
            title="Завершить поездку?"
            description="Поездка будет остановлена там, где находится самокат. Пользователь оплатит использованное время."
            okText="Завершить"
            cancelText="Отмена"
            okButtonProps={{ danger: true }}
            onConfirm={() => {
              void forceEnd(ride);
            }}
          >
            <Button
              size="small"
              danger
              icon={<StopOutlined />}
              loading={endingId === ride.id}
            >
              Завершить
            </Button>
          </Popconfirm>
        ) : null,
    },
  ];

  if (error !== null) return <ErrorState message={error} onRetry={load} />;

  const activeCount = rides.filter((ride) => ride.status === 'active').length;

  return (
    <Card
      size="small"
      title={
        <Space>
          <span>Поездки</span>
          {activeCount > 0 ? (
            <Badge count={`${String(activeCount)} активных`} style={{ background: '#1677ff' }} />
          ) : null}
        </Space>
      }
      extra={
        <Segmented
          size="small"
          value={filter}
          onChange={(value) => {
            setFilter(value as RideStatus | 'all');
          }}
          options={[
            { label: 'Все', value: 'all' },
            { label: 'Активные', value: 'active' },
            { label: 'Завершённые', value: 'completed' },
          ]}
        />
      }
    >
      {isLoading ? (
        <TableSkeleton rows={8} />
      ) : rides.length === 0 ? (
        <EmptyState description="Поездок пока нет — начните поездку в приложении" />
      ) : (
        <Table
          rowKey="id"
          size="small"
          dataSource={rides}
          columns={columns}
          pagination={{ pageSize: 20, size: 'small' }}
          scroll={{ x: 1180 }}
        />
      )}
    </Card>
  );
}
