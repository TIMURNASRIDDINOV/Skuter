import { useCallback, useEffect, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Popconfirm,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { SubscriptionDetail } from '@ozothunder/shared';
import { apiFetch, ApiRequestError, type ListResponse } from '../lib/api.js';
import { useServerEvents } from '../lib/events.js';
import { formatDateTime, formatRelative } from '../lib/format.js';
import { formatSom } from '../lib/money.js';
import { GrantRentalModal } from '../components/GrantRentalModal.js';
import { SubscriptionStatusTag } from '../components/status.js';
import { EmptyState, ErrorState, TableSkeleton } from '../components/states.js';
import { useAdminSession } from '../providers/session.js';

/**
 * The phone / vehicle binding with an expiry, laid out the way commercial
 * fleet platforms show it: who, which scooter, which plan, until when.
 *
 * Also the desk itself. Weekly rent is an agreement made in person and the app
 * cannot sell one, so «Включить аренду» here is the only way one is ever
 * created — and «Прекратить» the only way one ends early.
 */
export function SubscriptionsPage(): React.ReactElement {
  const { message } = AntApp.useApp();
  const canManage = useAdminSession().can('subscriptions', 'manage');
  const [items, setItems] = useState<SubscriptionDetail[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [granting, setGranting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

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
  useServerEvents(load, ['subscription.created', 'subscription.ended']);

  const cancel = (row: SubscriptionDetail): void => {
    setCancellingId(row.id);
    apiFetch(`/admin/subscriptions/${row.id}`, { method: 'DELETE' })
      .then(() => {
        message.success(`Аренда самоката ${row.vehicle.qrCode} прекращена`);
        load();
      })
      .catch((cause: unknown) => {
        message.error(
          cause instanceof ApiRequestError ? cause.message : 'Не удалось прекратить аренду',
        );
      })
      .finally(() => {
        setCancellingId(null);
      });
  };

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
    {
      title: 'Клиент',
      dataIndex: 'userName',
      width: 160,
      ellipsis: true,
      render: (value: string | null) =>
        value ?? <Typography.Text type="secondary">не указано</Typography.Text>,
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
    {
      // Weekly rent has no ride behind it — the scooter is switched on with a
      // lock command — so this column is the only place the back office can
      // see whether it is running right now.
      title: 'Самокат',
      key: 'unlocked',
      width: 120,
      render: (_, row) =>
        row.status !== 'active' ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : row.unlockedAt !== null ? (
          <Tooltip title={`Включён ${formatDateTime(row.unlockedAt)}`}>
            <Tag color="success">Включён</Tag>
          </Tooltip>
        ) : (
          <Tag>Заблокирован</Tag>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 130,
      fixed: 'right',
      render: (_, row) =>
        row.status !== 'active' || !canManage ? null : (
          <Popconfirm
            title="Прекратить аренду?"
            description={`Самокат ${row.vehicle.qrCode} вернётся на карту.`}
            okText="Прекратить"
            cancelText="Отмена"
            okButtonProps={{ danger: true }}
            onConfirm={() => {
              cancel(row);
            }}
          >
            <Button size="small" danger loading={cancellingId === row.id}>
              Прекратить
            </Button>
          </Popconfirm>
        ),
    },
  ];

  // Note what is deliberately *not* here: an early `return <ErrorState/>`.
  // That is what this page used to do, and it took «Включить аренду» down with
  // the table — so an API the panel could not reach looked exactly like a
  // build with no rental feature in it. The action is not a property of the
  // list loading; it is the reason an operator opened this page.
  return (
    <Card
      size="small"
      title={error !== null ? 'Абонементы и аренда' : `Абонементы и аренда — ${String(items.length)}`}
      extra={
        canManage ? (
          <Button
            type="primary"
            size="small"
            onClick={() => {
              setGranting(true);
            }}
          >
            Включить аренду
          </Button>
        ) : null
      }
    >
      {error !== null ? (
        <ErrorState message={error} onRetry={load} />
      ) : isLoading ? (
        <TableSkeleton rows={6} />
      ) : items.length === 0 ? (
        <EmptyState description="Аренд пока нет — включите первую кнопкой сверху" />
      ) : (
        <Table
          rowKey="id"
          size="small"
          dataSource={items}
          columns={columns}
          pagination={{ pageSize: 20, size: 'small' }}
          scroll={{ x: 1580 }}
        />
      )}

      <GrantRentalModal
        open={granting}
        onClose={() => {
          setGranting(false);
        }}
        onGranted={load}
      />
    </Card>
  );
}
