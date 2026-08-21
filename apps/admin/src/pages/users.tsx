import { useCallback, useEffect, useState } from 'react';
import { Card, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { User } from '@scoot/shared';
import { apiFetch, type ListResponse } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import { formatSom } from '../lib/money.js';
import { EmptyState, ErrorState, TableSkeleton } from '../components/states.js';

/**
 * How this rider got in. `email` is only ever set by Google sign-in and
 * `telegramId` only by the bot, so the account's origin is readable off the
 * row without another column in the database.
 */
function authMethod(user: User): { key: string; label: string; colour: string } {
  if (user.email !== null) return { key: 'google', label: 'Google', colour: 'red' };
  if (user.telegramId !== null) return { key: 'telegram', label: 'Telegram', colour: 'blue' };
  return { key: 'phone', label: 'Телефон', colour: 'default' };
}

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
      // A rider who signed up with Google or Telegram has no number until they
      // link one, which they must do before their first ride.
      render: (value: string | null) =>
        value !== null ? (
          <Typography.Text strong>{value}</Typography.Text>
        ) : (
          <Tag color="warning">не подтверждён</Tag>
        ),
    },
    {
      title: 'Вход',
      key: 'authMethod',
      width: 130,
      filters: [
        { text: 'Телефон', value: 'phone' },
        { text: 'Google', value: 'google' },
        { text: 'Telegram', value: 'telegram' },
      ],
      onFilter: (value, user) => authMethod(user).key === value,
      render: (_, user) => {
        const method = authMethod(user);
        return <Tag color={method.colour}>{method.label}</Tag>;
      },
    },
    {
      title: 'Имя',
      dataIndex: 'name',
      width: 200,
      render: (value: string | null) =>
        value ?? <Typography.Text type="secondary">не указано</Typography.Text>,
    },
    {
      title: 'Email',
      dataIndex: 'email',
      width: 220,
      render: (value: string | null) =>
        value ?? <Typography.Text type="secondary">—</Typography.Text>,
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
