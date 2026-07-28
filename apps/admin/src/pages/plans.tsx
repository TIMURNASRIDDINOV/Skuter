import { useCallback, useEffect, useState } from 'react';
import { App as AntApp, Button, Card, Form, InputNumber, Modal, Table, Tag, Typography } from 'antd';
import { EditOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { somToTiyin, tiyinToSom, type Plan } from '@scoot/shared';
import { apiFetch, type ListResponse } from '../lib/api.js';
import { formatSom } from '../lib/money.js';
import { EmptyState, ErrorState, TableSkeleton } from '../components/states.js';

const KIND_LABEL: Record<string, string> = {
  per_minute: 'Поминутный',
  daily: 'Дневной',
  weekly: 'Недельный',
};

/** Pricing editor. Amounts are entered in so'm and stored as integer tiyin. */
export function PlansPage(): React.ReactElement {
  const { message } = AntApp.useApp();
  const [items, setItems] = useState<Plan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form] = Form.useForm<{ unlockFee: number; price: number }>();

  const load = useCallback(() => {
    apiFetch<ListResponse<Plan>>('/admin/plans')
      .then((response) => {
        setItems(response.items);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить тарифы');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(load, [load]);

  const save = useCallback(
    async (values: { unlockFee: number; price: number }) => {
      if (editing === null) return;
      try {
        await apiFetch<Plan>(`/admin/plans/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            unlockFee: somToTiyin(values.unlockFee),
            price: somToTiyin(values.price),
          }),
        });
        message.success('Тариф обновлён');
        setEditing(null);
        load();
      } catch (cause: unknown) {
        message.error(cause instanceof Error ? cause.message : 'Не удалось сохранить тариф');
      }
    },
    [editing, load, message],
  );

  const columns: ColumnsType<Plan> = [
    {
      title: 'Название',
      dataIndex: 'name',
      render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
    },
    {
      title: 'Тип',
      dataIndex: 'kind',
      width: 140,
      render: (kind: string) => <Tag>{KIND_LABEL[kind] ?? kind}</Tag>,
    },
    {
      title: 'Плата за разблокировку',
      dataIndex: 'unlockFee',
      width: 200,
      align: 'right',
      render: (tiyin: number) => formatSom(tiyin),
    },
    {
      title: 'Цена',
      dataIndex: 'price',
      width: 180,
      align: 'right',
      render: (tiyin: number, plan) => (
        <span>
          {formatSom(tiyin)}
          {plan.kind === 'per_minute' ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {' '}
              / мин
            </Typography.Text>
          ) : null}
        </span>
      ),
    },
    {
      title: 'Срок',
      dataIndex: 'durationDays',
      width: 100,
      render: (days: number | null) => (days === null ? '—' : `${String(days)} дн.`),
    },
    {
      title: '',
      key: 'actions',
      width: 60,
      render: (_, plan) => (
        <Button
          size="small"
          type="text"
          icon={<EditOutlined />}
          onClick={() => {
            setEditing(plan);
            form.setFieldsValue({
              unlockFee: tiyinToSom(plan.unlockFee),
              price: tiyinToSom(plan.price),
            });
          }}
        />
      ),
    },
  ];

  if (error !== null) return <ErrorState message={error} onRetry={load} />;

  return (
    <Card size="small" title="Тарифы и цены">
      {isLoading ? (
        <TableSkeleton rows={3} />
      ) : items.length === 0 ? (
        <EmptyState description="Тарифов нет — запустите pnpm db:seed" />
      ) : (
        <Table
          rowKey="id"
          size="small"
          dataSource={items}
          columns={columns}
          pagination={false}
        />
      )}

      <Modal
        open={editing !== null}
        title={editing === null ? '' : `Изменить: ${editing.name}`}
        okText="Сохранить"
        cancelText="Отмена"
        onCancel={() => {
          setEditing(null);
        }}
        onOk={() => {
          void form.submit();
        }}
      >
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item
            name="unlockFee"
            label="Плата за разблокировку, сум"
            rules={[{ required: true, message: 'Укажите сумму' }]}
          >
            <InputNumber min={0} step={500} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="price"
            label={
              editing?.kind === 'per_minute' ? 'Цена за минуту, сум' : 'Цена абонемента, сум'
            }
            rules={[{ required: true, message: 'Укажите сумму' }]}
          >
            <InputNumber min={0} step={500} style={{ width: '100%' }} />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Суммы вводятся в сумах и хранятся в тийинах целым числом.
          </Typography.Text>
        </Form>
      </Modal>
    </Card>
  );
}
