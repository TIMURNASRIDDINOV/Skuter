import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, Col, Row, Statistic, Typography } from 'antd';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DashboardStats, RevenuePoint, Zone } from '@scoot/shared';
import { apiFetch, type ListResponse } from '../lib/api.js';
import { useServerEvents } from '../lib/events.js';
import { useLiveFleet } from '../lib/useLiveFleet.js';
import { formatSom, tiyinToSomNumber } from '../lib/money.js';
import { FleetLegend, FleetMap } from '../components/FleetMap.js';
import { CardSkeleton, ErrorState } from '../components/states.js';

export function DashboardPage(): React.ReactElement {
  const { vehicles, isLoading: fleetLoading, error: fleetError, refetch } = useLiveFleet();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [revenue, setRevenue] = useState<RevenuePoint[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(() => {
    Promise.all([
      apiFetch<DashboardStats>('/admin/stats'),
      apiFetch<ListResponse<RevenuePoint>>('/admin/revenue?days=14'),
      apiFetch<ListResponse<Zone>>('/admin/zones'),
    ])
      .then(([nextStats, nextRevenue, nextZones]) => {
        setStats(nextStats);
        setRevenue(nextRevenue.items);
        setZones(nextZones.items);
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

  if (error !== null && stats === null) {
    return <ErrorState message={error} onRetry={loadStats} />;
  }

  const chartData = revenue.map((point) => ({
    date: point.date.slice(5),
    revenue: tiyinToSomNumber(point.revenueTiyin),
    rides: point.rides,
  }));

  return (
    <div>
      <Row gutter={[12, 12]}>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            {stats === null ? (
              <CardSkeleton height={60} />
            ) : (
              <Statistic title="Всего самокатов" value={stats.vehiclesTotal} />
            )}
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            {stats === null ? (
              <CardSkeleton height={60} />
            ) : (
              <Statistic
                title="Свободны"
                value={stats.vehiclesAvailable}
                valueStyle={{ color: '#52c41a' }}
              />
            )}
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            {stats === null ? (
              <CardSkeleton height={60} />
            ) : (
              <Statistic
                title="В поездке"
                value={stats.vehiclesInUse}
                valueStyle={{ color: '#1677ff' }}
              />
            )}
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            {stats === null ? (
              <CardSkeleton height={60} />
            ) : (
              <Statistic
                title="Низкий заряд"
                value={stats.vehiclesLowBattery}
                valueStyle={{ color: '#faad14' }}
              />
            )}
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            {stats === null ? (
              <CardSkeleton height={60} />
            ) : (
              <Statistic
                title="Не на связи"
                value={stats.vehiclesOffline}
                valueStyle={{ color: '#8c8c8c' }}
              />
            )}
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            {stats === null ? (
              <CardSkeleton height={60} />
            ) : (
              <Statistic
                title="Средний заряд"
                value={stats.averageBatteryPct}
                suffix="%"
                precision={1}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            {stats === null ? (
              <CardSkeleton height={60} />
            ) : (
              <Statistic
                title="Активные поездки"
                value={stats.ridesActive}
                prefix={<Badge status="processing" />}
              />
            )}
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            {stats === null ? (
              <CardSkeleton height={60} />
            ) : (
              <Statistic title="Поездок за сутки" value={stats.ridesToday} />
            )}
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            {stats === null ? (
              <CardSkeleton height={60} />
            ) : (
              <Statistic title="Абонементы" value={stats.subscriptionsActive} />
            )}
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            {stats === null ? (
              <CardSkeleton height={60} />
            ) : (
              <Statistic title="Пользователи" value={stats.usersTotal} />
            )}
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            {stats === null ? (
              <CardSkeleton height={60} />
            ) : (
              <Statistic title="Выручка за сутки" value={formatSom(stats.revenueTodayTiyin)} />
            )}
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            {stats === null ? (
              <CardSkeleton height={60} />
            ) : (
              <Statistic title="Выручка за неделю" value={formatSom(stats.revenueWeekTiyin)} />
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
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
              <CardSkeleton height={460} />
            ) : (
              <>
                <FleetMap vehicles={vehicles} zones={zones} height={460} />
                <FleetLegend />
              </>
            )}
          </Card>
        </Col>

        <Col xs={24} xl={9}>
          <Card size="small" title="Выручка, 14 дней">
            {chartData.length === 0 ? (
              <div style={{ padding: '48px 0', textAlign: 'center' }}>
                <Typography.Text type="secondary">
                  Пока нет завершённых поездок — выручка появится после первой.
                </Typography.Text>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={56} />
                  <ChartTooltip
                    formatter={(value) => [`${Number(value ?? 0).toLocaleString('ru')} сум`, 'Выручка']}
                  />
                  <Bar dataKey="revenue" fill="#1677ff" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card size="small" title="Поездки, 14 дней" style={{ marginTop: 12 }}>
            {chartData.length === 0 ? (
              <div style={{ padding: '48px 0', textAlign: 'center' }}>
                <Typography.Text type="secondary">Нет данных за период.</Typography.Text>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} width={36} allowDecimals={false} />
                  <ChartTooltip formatter={(value) => [Number(value ?? 0), 'Поездок']} />
                  <Line type="monotone" dataKey="rides" stroke="#52c41a" strokeWidth={2} dot />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
