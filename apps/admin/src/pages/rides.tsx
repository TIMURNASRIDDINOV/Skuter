import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Popconfirm,
  Segmented,
  Space,
  Table,
  Typography,
} from 'antd';
import { StopOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { RideReceipt, RideStatus } from '@scoot/shared';
import { apiFetch, type ListResponse } from '../lib/api.js';
import { useServerEvents } from '../lib/events.js';
import { formatDuration, formatDistance, formatTime, plural } from '../lib/format.js';
import { formatSom } from '../lib/money.js';
import { DEFAULT_THRESHOLDS, classifyRide } from '../lib/anomalies.js';
import { RideStatusTag, SEVERITY_META, type Severity } from '../components/status.js';
import { useRecentlyChanged } from '../components/motion.js';
import { RideDrawer, type RideRow } from '../components/RideDrawer.js';
import { EmptyState, ErrorState, TableSkeleton } from '../components/states.js';

const rideId = (ride: RideRow): string => ride.id;
// Duration and cost tick constantly; only a ride starting or ending is news.
const rideSignature = (ride: RideRow): string => ride.status;

/**
 * Live rides — demo step 3. A ride started on the phone appears here without a
 * refresh, and its duration, distance and cost tick as it runs.
 *
 * Opens on the active rides rather than on everything ever, because unlike the
 * fleet list this screen genuinely is a work queue (docs/reference-review.md
 * §3.2 explains why the two screens default differently).
 */
export function RidesPage(): React.ReactElement {
  const { message } = AntApp.useApp();
  const [rides, setRides] = useState<RideRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RideStatus | 'all'>('active');
  const [endingId, setEndingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // A running ride's clock should move every second, not only when the
  // simulator next emits. Duration is pure arithmetic on startedAt, so it can
  // tick locally; cost still comes from the server, which owns pricing.
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

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

  /** Server duration for finished rides, wall clock for running ones. */
  const liveDuration = useCallback(
    (ride: RideRow): number =>
      ride.status === 'active'
        ? Math.max(0, Math.round((now - Date.parse(ride.startedAt)) / 1000))
        : ride.durationS,
    [now],
  );

  const flashing = useRecentlyChanged(rides, rideId, rideSignature);
  const selected = useMemo(
    () => rides.find((ride) => ride.id === selectedId) ?? null,
    [rides, selectedId],
  );

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
        setSelectedId(null);
        load();
      } catch (cause: unknown) {
        message.error(cause instanceof Error ? cause.message : 'Не удалось завершить поездку');
      } finally {
        setEndingId(null);
      }
    },
    [load, message],
  );

  const active = useMemo(() => rides.filter((ride) => ride.status === 'active'), [rides]);

  const flagged = useMemo(() => {
    const map = new Map<string, { severity: Exclude<Severity, 'ok'>; detail: string }>();
    for (const ride of active) {
      const fault = classifyRide(
        { durationS: liveDuration(ride), distanceM: ride.distanceM },
        DEFAULT_THRESHOLDS,
      );
      if (fault !== null) map.set(ride.id, fault);
    }
    return map;
  }, [active, liveDuration]);

  const longest = useMemo(
    () => active.reduce((max, ride) => Math.max(max, liveDuration(ride)), 0),
    [active, liveDuration],
  );

  const columns: ColumnsType<RideRow> = [
    {
      title: 'Поездка',
      dataIndex: 'vehicleQrCode',
      width: 190,
      render: (code: string, ride) => {
        const fault = flagged.get(ride.id);
        return (
          <Space size={8}>
            <span
              aria-label={fault === undefined ? 'Норма' : SEVERITY_META[fault.severity].label}
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                flex: '0 0 auto',
                display: 'inline-block',
                background:
                  fault === undefined ? 'transparent' : SEVERITY_META[fault.severity].colour,
              }}
            />
            <span>
              <Typography.Text strong style={{ fontFamily: 'monospace' }}>
                {code}
              </Typography.Text>
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                {ride.userPhone ?? 'Telegram'}
              </Typography.Text>
            </span>
          </Space>
        );
      },
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 120,
      render: (status: string, ride) => {
        const fault = flagged.get(ride.id);
        return (
          <span>
            <RideStatusTag status={status} />
            {fault === undefined ? null : (
              <>
                <br />
                <Typography.Text
                  style={{ fontSize: 11, color: SEVERITY_META[fault.severity].colour }}
                >
                  {fault.detail}
                </Typography.Text>
              </>
            )}
          </span>
        );
      },
    },
    {
      title: 'Начало',
      dataIndex: 'startedAt',
      width: 100,
      sorter: (a, b) => a.startedAt.localeCompare(b.startedAt),
      defaultSortOrder: 'descend',
      render: (iso: string) => (
        <Typography.Text type="secondary" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatTime(iso)}
        </Typography.Text>
      ),
    },
    {
      title: 'Длительность',
      dataIndex: 'durationS',
      width: 115,
      align: 'right',
      sorter: (a, b) => a.durationS - b.durationS,
      render: (_: number, ride) => (
        <Typography.Text style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatDuration(liveDuration(ride))}
        </Typography.Text>
      ),
    },
    {
      title: 'Расстояние',
      dataIndex: 'distanceM',
      width: 105,
      align: 'right',
      sorter: (a, b) => a.distanceM - b.distanceM,
      render: (metres: number) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatDistance(metres)}</span>
      ),
    },
    {
      title: 'Стоимость',
      dataIndex: 'cost',
      width: 120,
      align: 'right',
      sorter: (a, b) => a.cost - b.cost,
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
      title: '',
      key: 'actions',
      width: 120,
      render: (_, ride) =>
        ride.status !== 'active' ? null : (
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
              onClick={(event) => {
                // The row opens the drawer; the button must not.
                event.stopPropagation();
              }}
            >
              Завершить
            </Button>
          </Popconfirm>
        ),
    },
  ];

  if (error !== null) return <ErrorState message={error} onRetry={load} />;

  return (
    <>
      <Card size="small">
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
            Поездки{' '}
            <Typography.Text type="secondary" style={{ fontWeight: 400 }}>
              {active.length > 0
                ? `${String(active.length)} ${plural(active.length, 'активная', 'активные', 'активных')} · самая долгая ${formatDuration(longest)}`
                : 'нет активных'}
            </Typography.Text>
          </Typography.Text>

          <Segmented
            size="small"
            value={filter}
            onChange={(value) => {
              setFilter(value as RideStatus | 'all');
            }}
            options={[
              { label: 'Активные', value: 'active' },
              { label: 'Завершённые', value: 'completed' },
              { label: 'Все', value: 'all' },
            ]}
          />
        </div>

        {isLoading ? (
          <TableSkeleton rows={8} />
        ) : rides.length === 0 ? (
          <EmptyState
            description={
              filter === 'active'
                ? 'Сейчас никто не едет — начните поездку в приложении'
                : 'Поездок пока нет'
            }
          />
        ) : (
          <Table
            rowKey="id"
            size="small"
            dataSource={rides}
            columns={columns}
            rowClassName={(ride) => (flashing.has(ride.id) ? 'scoot-flash' : '')}
            onRow={(ride) => ({
              onClick: () => {
                setSelectedId(ride.id);
              },
              style: { cursor: 'pointer' },
            })}
            pagination={{ pageSize: 20, size: 'small' }}
            scroll={{ x: 900 }}
          />
        )}
      </Card>

      <RideDrawer
        ride={selected}
        liveDurationS={selected === null ? null : liveDuration(selected)}
        isEnding={endingId !== null && endingId === selectedId}
        onForceEnd={(ride) => {
          void forceEnd(ride);
        }}
        onClose={() => {
          setSelectedId(null);
        }}
      />
    </>
  );
}
