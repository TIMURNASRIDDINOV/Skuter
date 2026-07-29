import { useCallback, useEffect, useState } from 'react';
import { Card, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { User } from '@scoot/shared';
import { apiFetch, type ListResponse } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import { formatSom } from '../lib/money.js';
import { EmptyState, ErrorState, TableSkeleton } from '../components/states.js';

export function UsersPage(): React.ReactElement {
  const [items, setItems] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<ListResponse<User>>('/admin/users')
      .then((response) => {
        setItems(response.items);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить пользователей');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(load, [load]);

  const columns: ColumnsType<User> = [
    {
      title: 'Телефон',
      dataIndex: 'phone',
      width: 170,
      render: (value: string | null) =>
        value !== null ? <Typography.Text strong>{value}</Typography.Text> : <Tag>Telegram</Tag>,
    },
    {
      title: 'Имя',
      dataIndex: 'name',
      width: 220,
      render: (value: string | null) =>
        value ?? <Typography.Text type="secondary">не указано</Typography.Text>,
    },
    {
      title: 'Статус',
      dataIndex: 'status',
      width: 120,
      render: (status: string) => (
        <Tag color={status === 'active' ? 'success' : 'error'}>
          {status === 'active' ? 'Активен' : 'Заблокирован'}
        </Tag>
      ),
    },
    {
      title: 'Баланс',
      dataIndex: 'balance',
      width: 140,
      align: 'right',
      sorter: (a, b) => a.balance - b.balance,
      render: (tiyin: number) => formatSom(tiyin),
    },
    {
      title: 'Регистрация',
      dataIndex: 'createdAt',
      width: 160,
      render: (iso: string) => formatDateTime(iso),
    },
  ];

  if (error !== null) return <ErrorState message={error} onRetry={load} />;

  return (
    <Card
      size="small"
      title={`Пользователи — ${String(items.length)}`}>
      {isLoading ? (
        <TableSkeleton rows={6} />
      ) : items.length === 0 ? (
        <EmptyState description="Пользователей пока нет" />
      ) : (
        <Table
          rowKey="id"
          size="small"
          dataSource={items}
          columns={columns}
          pagination={{ pageSize: 20, size: 'small' }}
        />
      )}
    </Card>
  );
}
