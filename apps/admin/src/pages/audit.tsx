import { useCallback, useEffect, useState } from 'react';
import { Card, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { AuditLogRow } from '@ozothunder/shared';
import { apiFetch, type ListResponse } from '../lib/api.js';
import { useServerEvents } from '../lib/events.js';
import { formatDateTime } from '../lib/format.js';
import { EmptyState, ErrorState, TableSkeleton } from '../components/states.js';

export function AuditPage(): React.ReactElement {
  const [items, setItems] = useState<AuditLogRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<ListResponse<AuditLogRow>>('/admin/audit')
      .then((response) => {
        setItems(response.items);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить журнал');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(load, [load]);
  useServerEvents(load, ['zone.changed']);

  const columns: ColumnsType<AuditLogRow> = [
    {
      title: 'Время',
      dataIndex: 'createdAt',
      width: 160,
      render: (iso: string) => formatDateTime(iso),
    },
    {
      title: 'Администратор',
      dataIndex: 'adminEmail',
      width: 200,
      render: (email: string | null) =>
        email ?? <Typography.Text type="secondary">система</Typography.Text>,
    },
    {
      title: 'Действие',
      dataIndex: 'action',
      width: 200,
      render: (action: string) => <Tag>{action}</Tag>,
    },
    { title: 'Объект', dataIndex: 'entity', width: 120 },
    {
      title: 'Детали',
      dataIndex: 'payload',
      ellipsis: true,
      render: (payload: unknown) => (
        <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
          {payload === null || payload === undefined ? '—' : JSON.stringify(payload)}
        </Typography.Text>
      ),
    },
  ];

  if (error !== null) return <ErrorState message={error} onRetry={load} />;

  return (
    <Card size="small" title="Журнал действий">
      {isLoading ? (
        <TableSkeleton rows={6} />
      ) : items.length === 0 ? (
        <EmptyState description="Журнал пуст — действия администраторов появятся здесь" />
      ) : (
        <Table
          rowKey="id"
          size="small"
          dataSource={items}
          columns={columns}
          pagination={{ pageSize: 25, size: 'small' }}
        />
      )}
    </Card>
  );
}
