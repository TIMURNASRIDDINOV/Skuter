import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { User } from '@ozothunder/shared';
import { apiFetch, type ListResponse } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import { formatSom } from '../lib/money.js';
import { GrantRentalModal } from '../components/GrantRentalModal.js';
import { EmptyState, ErrorState, TableSkeleton } from '../components/states.js';
import { useAdminSession } from '../providers/session.js';

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

/**
 * The rider list, and where the weekly-rent conversation starts.
 *
 * Somebody walks in and asks for a scooter for a week: the operator finds them
 * here by phone or name, hits «Включить аренду» on their row, and the rental
 * exists. Filtering is client-side over the loaded list — the fleet's rider
 * count is small, and a live round trip per keystroke would be slower than
 * scanning what is already on screen.
 */
export function UsersPage(): React.ReactElement {
  // Granting a rental is a subscriptions write, not a users one — the column
  // lives here only because this is where the conversation starts.
  const canGrant = useAdminSession().can('subscriptions', 'manage');
  const [items, setItems] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [grantingFor, setGrantingFor] = useState<User | null>(null);

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

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term === '') return items;
    // Numbers are stored E.164 but nobody types them that way, so a digits-only
    // needle matches a digits-only haystack: `90 123` finds `+998901234567`.
    const digits = term.replace(/\D/g, '');
    return items.filter(
      (user) =>
        (digits !== '' && (user.phone ?? '').includes(digits)) ||
        (user.name ?? '').toLowerCase().includes(term) ||
        (user.email ?? '').toLowerCase().includes(term),
    );
  }, [items, search]);

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
    ...(canGrant
      ? [
          {
            title: '',
            key: 'actions',
            width: 150,
            fixed: 'right' as const,
            render: (_: unknown, user: User) => (
              <Button
                size="small"
                disabled={user.status !== 'active'}
                onClick={() => {
                  setGrantingFor(user);
                }}
              >
                Включить аренду
              </Button>
            ),
          },
        ]
      : []),
  ];

  // Same reasoning as the subscriptions page: an unreachable API must not make
  // the rental action disappear, or a connection problem is indistinguishable
  // from a missing feature.
  return (
    <Card
      size="small"
      title={error !== null ? 'Пользователи' : `Пользователи — ${String(filtered.length)}`}
      extra={
        <Input.Search
          allowClear
          size="small"
          placeholder="Телефон, имя или email"
          style={{ width: 260 }}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      }
    >
      {error !== null ? (
        <ErrorState message={error} onRetry={load} />
      ) : isLoading ? (
        <TableSkeleton rows={6} />
      ) : items.length === 0 ? (
        <EmptyState description="Пользователей пока нет" />
      ) : filtered.length === 0 ? (
        <EmptyState description={`По запросу «${search}» никого не найдено`} />
      ) : (
        <Table
          rowKey="id"
          size="small"
          dataSource={filtered}
          columns={columns}
          pagination={{ pageSize: 20, size: 'small' }}
          scroll={{ x: 1330 }}
        />
      )}

      <GrantRentalModal
        open={grantingFor !== null}
        rider={grantingFor}
        onClose={() => {
          setGrantingFor(null);
        }}
        onGranted={load}
      />
    </Card>
  );
}
