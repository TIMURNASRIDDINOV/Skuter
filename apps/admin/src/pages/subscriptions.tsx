import { useCallback, useEffect, useState } from 'react';
import { Card, Table, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { SubscriptionDetail } from '@scoot/shared';
import { apiFetch, type ListResponse } from '../lib/api.js';
import { useServerEvents } from '../lib/events.js';
import { formatDateTime, formatRelative } from '../lib/format.js';
import { formatSom } from '../lib/money.js';
import { SubscriptionStatusTag } from '../components/status.js';
import { EmptyState, ErrorState, TableSkeleton } from '../components/states.js';

/**
 * Demo step 6 — the phone / vehicle binding with an expiry, laid out the way
 * commercial fleet platforms show it: who, which scooter, which plan, until when.
 */
export function SubscriptionsPage(): React.ReactElement {
  const [items, setItems] = useState<SubscriptionDetail[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<ListResponse<SubscriptionDetail>>('/admin/subscriptions')
      .then((response) => {
        setItems(response.items);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить абонементы');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(load, [load]);
  useServerEvents(load, ['subscription.created']);

  const columns: ColumnsType<SubscriptionDetail> = [
    {
      title: 'Телефон',
      dataIndex: 'userPhone',
      width: 160,
      render: (value: string | null) =>
        value !== null ? <Typography.Text strong>{value}</Typography.Text> : 'Telegram',
    },
    {
      title: 'Самокат',
      key: 'vehicle',
      width: 150,
      render: (_, row) => (
        <Typography.Text strong>{row.vehicle.qrCode}</Typography.Text>
      ),
    },
    {
      title: 'Модель',
      key: 'model',
      width: 150,
      ellipsis: true,
      render: (_, row) => (
        <Typography.Text type="secondary">{row.vehicle.model}</Typography.Text>
      ),
    },
    { title: 'Тариф', key: 'plan', width: 180, render: (_, row) => row.plan.name },
    {
      title: 'Стоимость',
      key: 'price',
      width: 130,
      align: 'right',
      render: (_, row) => formatSom(row.plan.price),
    },
    {
      title: 'Начало',
      dataIndex: 'startsAt',
      width: 150,
      render: (iso: string) => formatDateTime(iso),
    },
    {
      title: 'Истекает',
      dataIndex: 'expiresAt',
      width: 190,
      sorter: (a, b) => a.expiresAt.localeCompare(b.expiresAt),
      render: (iso: string) => (
        <Tooltip title={formatDateTime(iso)}>
          <Typography.Text>{formatDateTime(iso)}</Typography.Text>{' '}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            ({formatRelative(iso)})
          </Typography.Text>
        </Tooltip>
      ),
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 120,
      render: (status: string) => <SubscriptionStatusTag status={status} />,
    },
  ];

  if (error !== null) return <ErrorState message={error} onRetry={load} />;

  return (
    <Card size="small" title={`Абонементы — ${String(items.length)}`}>
      {isLoading ? (
        <TableSkeleton rows={6} />
      ) : items.length === 0 ? (
        <EmptyState description="Абонементов пока нет — оформите один в приложении" />
      ) : (
        <Table
          rowKey="id"
          size="small"
          dataSource={items}
          columns={columns}
          pagination={{ pageSize: 20, size: 'small' }}
          scroll={{ x: 1180 }}
        />
      )}
    </Card>
  );
}
