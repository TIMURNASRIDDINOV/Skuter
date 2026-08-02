import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Col, Divider, Row, Space, Typography, theme } from 'antd';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DashboardStats, Ride, RevenuePoint, Zone } from '@scoot/shared';
import { apiFetch, type ListResponse } from '../lib/api.js';
import { useServerEvents } from '../lib/events.js';
import { useLiveFleet } from '../lib/useLiveFleet.js';
import { formatSom, tiyinToSomNumber } from '../lib/money.js';
import { plural } from '../lib/format.js';
import {
  DEFAULT_THRESHOLDS,
  countBySeverity,
  deriveAnomalies,
  toAttentionRows,
  type AnomalyThresholds,
} from '../lib/anomalies.js';
import { FleetLegend, FleetMap } from '../components/FleetMap.js';
import { AttentionList } from '../components/AttentionList.js';
import { SEVERITY_META } from '../components/status.js';
import { AnimatedNumber } from '../components/motion.js';
import { CardSkeleton, ErrorState } from '../components/states.js';

type ActiveRide = Ride & { vehicleQrCode: string };

/**
 * Opens with what needs doing, not with what we can count.
 *
 * Two figures are large and immediate — how much of the fleet is earning, and
 * how much is moving right now. Everything else is either in the attention
 * queue beneath them or on one compact secondary line. See
 * docs/reference-review.md §3.1 for what this replaced and why.
 */
export function DashboardPage(): React.ReactElement {
  const { vehicles, isLoading: fleetLoading, error: fleetError, refetch } = useLiveFleet();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [revenue, setRevenue] = useState<RevenuePoint[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [activeRides, setActiveRides] = useState<ActiveRide[]>([]);
  const [thresholds, setThresholds] = useState<AnomalyThresholds>(DEFAULT_THRESHOLDS);
  const [error, setError] = useState<string | null>(null);
  const { token } = theme.useToken();

  const loadStats = useCallback(() => {
    Promise.all([
      apiFetch<DashboardStats>('/admin/stats'),
      apiFetch<ListResponse<RevenuePoint>>('/admin/revenue?days=14'),
      apiFetch<ListResponse<Zone>>('/admin/zones'),
      apiFetch<ListResponse<ActiveRide>>('/admin/rides?status=active'),
    ])
      .then(([nextStats, nextRevenue, nextZones, nextRides]) => {
        setStats(nextStats);
        setRevenue(nextRevenue.items);
        setZones(nextZones.items);
        setActiveRides(nextRides.items);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить показатели');
      });
  }, []);

  useEffect(loadStats, [loadStats]);

  // Ride and subscription events move the KPI numbers; refresh them rather than
  // trying to recompute aggregates on the client.
  useServerEvents(loadStats, ['ride.started', 'ride.ended', 'subscription.created']);

  // A running ride's duration and distance decide whether it is overlong or
  // stalled, so keep them current between refetches.
  useServerEvents(
    useCallback((event) => {
      if (event.type !== 'ride.updated') return;
      setActiveRides((current) =>
        current.map((ride) =>
          ride.id === event.rideId
            ? { ...ride, distanceM: event.distanceM, durationS: event.durationS }
            : ride,
        ),
      );
    }, []),
    ['ride.updated'],
  );

  const anomalies = useMemo(
    () => deriveAnomalies({ vehicles, zones, activeRides, thresholds }),
    [vehicles, zones, activeRides, thresholds],
  );
  const rows = useMemo(() => toAttentionRows(anomalies), [anomalies]);
  const severity = useMemo(() => countBySeverity(anomalies), [anomalies]);

  if (error !== null && stats === null) {
    return <ErrorState message={error} onRetry={loadStats} />;
  }

  const chartData = revenue.map((point) => ({
    date: point.date.slice(5),
    revenue: tiyinToSomNumber(point.revenueTiyin),
    rides: point.rides,
  }));

  return (
    <Row gutter={[12, 12]}>
      <Col xs={24} xl={9}>
        <Card size="small" style={{ height: '100%' }}>
          {stats === null ? (
            <CardSkeleton height={132} />
          ) : (
            <>
              <Row gutter={12}>
                <Col span={12}>
                  <Hero
                    label="Свободно"
                    value={stats.vehiclesAvailable}
                    suffix={`из ${String(stats.vehiclesTotal)}`}
                    colour={token.colorSuccess}
                  />
                </Col>
                <Col span={12}>
                  <Hero
                    label="В поездке"
                    value={stats.ridesActive}
                    suffix="сейчас"
                    colour={token.colorPrimary}
                  />
                </Col>
              </Row>

              <Divider style={{ margin: '12px 0' }} />

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <Typography.Text strong>Требует внимания</Typography.Text>
                {severity.alarm > 0 ? (
                  <Typography.Text style={{ color: SEVERITY_META.alarm.colour, fontSize: 12 }}>
                    {severity.alarm}{' '}
                    {plural(severity.alarm, 'тревога', 'тревоги', 'тревог')}
                  </Typography.Text>
                ) : null}
              </div>

              <div style={{ marginTop: 4 }}>
                {fleetLoading ? (
                  <CardSkeleton height={220} />
                ) : (
                  <AttentionList
                    rows={rows}
                    thresholds={thresholds}
                    onThresholdsChange={setThresholds}
                  />
                )}
              </div>
            </>
          )}
        </Card>
      </Col>

      <Col xs={24} xl={15}>
        <Card
          size="small"
          title="Карта парка"
          extra={
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {vehicles.length} самокатов · обновляется в реальном времени
            </Typography.Text>
          }
        >
          {fleetError !== null ? (
            <ErrorState message={fleetError} onRetry={refetch} />
          ) : fleetLoading ? (
            <CardSkeleton height={430} />
          ) : (
            <>
              <FleetMap vehicles={vehicles} zones={zones} height={430} />
              <FleetLegend />
            </>
          )}
        </Card>
      </Col>

      <Col span={24}>
        <Card size="small">
          {stats === null ? (
            <CardSkeleton height={22} />
          ) : (
            <Secondary
              items={[
                { label: 'Поездок за сутки', value: String(stats.ridesToday) },
                { label: 'Выручка за сутки', value: formatSom(stats.revenueTodayTiyin) },
                { label: 'Выручка за неделю', value: formatSom(stats.revenueWeekTiyin) },
                { label: 'Абонементы', value: String(stats.subscriptionsActive) },
                { label: 'Пользователи', value: String(stats.usersTotal) },
                { label: 'Средний заряд', value: `${stats.averageBatteryPct.toFixed(1)} %` },
              ]}
            />
          )}
        </Card>
      </Col>

      <Col span={24}>
        <Card size="small" title="Выручка и поездки, 14 дней">
          {chartData.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <Typography.Text type="secondary">
                Пока нет завершённых поездок — выручка появится после первой.
              </Typography.Text>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={64} />
                <ChartTooltip
                  formatter={(value, name) =>
                    name === 'revenue'
                      ? [`${Number(value ?? 0).toLocaleString('ru')} сум`, 'Выручка']
                      : [Number(value ?? 0), 'Поездок']
                  }
                />
                <Bar dataKey="revenue" fill={token.colorPrimary} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </Col>
    </Row>
  );
}

function Hero({
  label,
  value,
  suffix,
  colour,
}: {
  label: string;
  value: number;
  suffix: string;
  colour: string;
}): React.ReactElement {
  return (
    <div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {label}
      </Typography.Text>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
        <span style={{ fontSize: 38, fontWeight: 600, lineHeight: 1.1, color: colour }}>
          <AnimatedNumber value={value} />
        </span>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {suffix}
        </Typography.Text>
      </div>
    </div>
  );
}

/** Everything that matters but should not compete with the two hero figures. */
function Secondary({
  items,
}: {
  items: { label: string; value: string }[];
}): React.ReactElement {
  return (
    <Space size={0} wrap split={<Divider type="vertical" style={{ margin: '0 16px' }} />}>
      {items.map((item) => (
        <Space key={item.label} size={6}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {item.label}
          </Typography.Text>
          <Typography.Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>
            {item.value}
          </Typography.Text>
        </Space>
      ))}
    </Space>
  );
}
