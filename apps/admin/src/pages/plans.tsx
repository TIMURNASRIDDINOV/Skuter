import { useCallback, useEffect, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { MINUTES_PER_DAY, somToTiyin, tiyinToSom, type Plan } from '@ozothunder/shared';
import { apiFetch, type ListResponse } from '../lib/api.js';
import { formatRentalDuration } from '../lib/format.js';
import { formatSom } from '../lib/money.js';
import { useAdminSession } from '../providers/session.js';
import { EmptyState, ErrorState, TableSkeleton } from '../components/states.js';

const KIND_LABEL: Record<string, string> = {
  per_minute: 'Поминутный',
  rental: 'Аренда',
};

type DurationUnit = 'hours' | 'days';

interface PlanFormValues {
  name: string;
  kind: Plan['kind'];
  unlockFee: number;
  price: number;
  durationValue: number;
  durationUnit: DurationUnit;
  officeOnly: boolean;
  active: boolean;
}

/**
 * Splits stored minutes back into the number and unit an operator typed.
 *
 * Whole days come back as days — somebody who entered «7 дней» should not
 * reopen the form and find 10 080 minutes staring at them. Everything else is
 * hours, which is the unit the app's rentals are sold in.
 */
function splitDuration(minutes: number | null): { value: number; unit: DurationUnit } {
  if (minutes === null) return { value: 3, unit: 'hours' };
  if (minutes >= MINUTES_PER_DAY && minutes % MINUTES_PER_DAY === 0) {
    return { value: minutes / MINUTES_PER_DAY, unit: 'days' };
  }
  return { value: Math.max(1, Math.round(minutes / 60)), unit: 'hours' };
}

function toMinutes(value: number, unit: DurationUnit): number {
  return unit === 'days' ? value * MINUTES_PER_DAY : value * 60;
}

/**
 * The tariff editor: every field of every plan, plus adding and removing them.
 *
 * A tariff is a commercial decision that changes more often than the code does
 * — a three-hour rent becomes an hour, a price moves for the season — so all of
 * it is editable here rather than seeded and frozen. Amounts are typed in so'm
 * and stored as integer tiyin; durations are typed in hours or days and stored
 * as minutes, which is what lets one plan be 3 h and another a week without two
 * different fields.
 *
 * Removing a plan is a real delete only while nothing references it. Once a
 * ride has been taken under it the API refuses, because the receipt still
 * resolves through the plan — «Активен» off is the retirement that leaves
 * history alone.
 */
export function PlansPage(): React.ReactElement {
  const { message } = AntApp.useApp();
  const session = useAdminSession();
  const canManage = session.can('plans', 'manage');
  const [items, setItems] = useState<Plan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<PlanFormValues>();

  // Watched so the duration and «только в офисе» rows can disappear for a
  // per-minute tariff, which has no window at all — the API rejects one that
  // carries a duration.
  const kind = Form.useWatch('kind', form) ?? 'rental';

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

  const openCreate = useCallback(() => {
    form.setFieldsValue({
      name: '',
      kind: 'rental',
      unlockFee: 0,
      price: 0,
      durationValue: 1,
      durationUnit: 'hours',
      officeOnly: false,
      active: true,
    });
    setEditing('new');
  }, [form]);

  const openEdit = useCallback(
    (plan: Plan) => {
      const duration = splitDuration(plan.durationMinutes);
      form.setFieldsValue({
        name: plan.name,
        kind: plan.kind,
        unlockFee: tiyinToSom(plan.unlockFee),
        price: tiyinToSom(plan.price),
        durationValue: duration.value,
        durationUnit: duration.unit,
        officeOnly: plan.officeOnly,
        active: plan.active,
      });
      setEditing(plan);
    },
    [form],
  );

  const save = useCallback(
    async (values: PlanFormValues) => {
      setSaving(true);
      const body = {
        name: values.name,
        kind: values.kind,
        unlockFee: somToTiyin(values.unlockFee),
        price: somToTiyin(values.price),
        durationMinutes:
          values.kind === 'per_minute'
            ? null
            : toMinutes(values.durationValue, values.durationUnit),
        officeOnly: values.kind === 'per_minute' ? false : values.officeOnly,
        active: values.active,
      };

      try {
        if (editing === 'new') {
          await apiFetch<Plan>('/admin/plans', { method: 'POST', body: JSON.stringify(body) });
          message.success(`Тариф «${values.name}» создан`);
        } else if (editing !== null) {
          // `kind` is deliberately not sent on update: turning a rental into a
          // per-minute tariff would rewrite what every subscription already
          // sold on it was sold as. Retire it and add a new one instead.
          const { kind: _kind, ...patch } = body;
          await apiFetch<Plan>(`/admin/plans/${editing.id}`, {
            method: 'PATCH',
            body: JSON.stringify(patch),
          });
          message.success('Тариф обновлён');
        }
        setEditing(null);
        load();
      } catch (cause: unknown) {
        message.error(cause instanceof Error ? cause.message : 'Не удалось сохранить тариф');
      } finally {
        setSaving(false);
      }
    },
    [editing, load, message],
  );

  const remove = useCallback(
    async (plan: Plan) => {
      try {
        await apiFetch(`/admin/plans/${plan.id}`, { method: 'DELETE' });
        message.success(`Тариф «${plan.name}» удалён`);
        load();
      } catch (cause: unknown) {
        message.error(cause instanceof Error ? cause.message : 'Не удалось удалить тариф');
      }
    },
    [load, message],
  );

  const columns: ColumnsType<Plan> = [
    {
      title: 'Название',
      dataIndex: 'name',
      render: (value: string, plan) => (
        <Space size={6}>
          <Typography.Text strong={plan.active} type={plan.active ? undefined : 'secondary'}>
            {value}
          </Typography.Text>
          {plan.active ? null : <Tag>выключен</Tag>}
        </Space>
      ),
    },
    {
      title: 'Тип',
      dataIndex: 'kind',
      width: 130,
      render: (kindValue: string) => <Tag>{KIND_LABEL[kindValue] ?? kindValue}</Tag>,
    },
    {
      title: 'Плата за разблокировку',
      dataIndex: 'unlockFee',
      width: 190,
      align: 'right',
      render: (tiyin: number) => formatSom(tiyin),
    },
    {
      title: 'Цена',
      dataIndex: 'price',
      width: 170,
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
      dataIndex: 'durationMinutes',
      width: 110,
      render: (minutes: number | null) => formatRentalDuration(minutes),
    },
    {
      title: 'Где продаётся',
      dataIndex: 'officeOnly',
      width: 150,
      render: (officeOnly: boolean, plan) =>
        plan.kind === 'per_minute' ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : officeOnly ? (
          <Tag color="gold">Только в офисе</Tag>
        ) : (
          <Tag color="green">В приложении</Tag>
        ),
    },
    ...(canManage
      ? [
          {
            title: '',
            key: 'actions',
            width: 80,
            render: (_: unknown, plan: Plan) => (
              <Space size={0}>
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined />}
                  onClick={() => {
                    openEdit(plan);
                  }}
                />
                <Popconfirm
                  title={`Удалить «${plan.name}»?`}
                  description="Если по нему уже были поездки, удалить нельзя — выключите его."
                  okText="Удалить"
                  okButtonProps={{ danger: true }}
                  cancelText="Отмена"
                  onConfirm={() => void remove(plan)}
                >
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ];

  if (error !== null) return <ErrorState message={error} onRetry={load} />;

  return (
    <Card
      size="small"
      title="Тарифы и цены"
      extra={
        canManage ? (
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Добавить тариф
          </Button>
        ) : null
      }
    >
      {isLoading ? (
        <TableSkeleton rows={3} />
      ) : items.length === 0 ? (
        <EmptyState description="Тарифов нет — добавьте первый кнопкой «Добавить тариф»" />
      ) : (
        <Table rowKey="id" size="small" dataSource={items} columns={columns} pagination={false} />
      )}

      <Modal
        open={editing !== null}
        title={editing === null || editing === 'new' ? 'Новый тариф' : `Изменить: ${editing.name}`}
        okText="Сохранить"
        cancelText="Отмена"
        confirmLoading={saving}
        onCancel={() => {
          setEditing(null);
        }}
        onOk={() => {
          form.submit();
        }}
        destroyOnHidden
        width={520}
      >
        <Form form={form} layout="vertical" onFinish={(values) => void save(values)}>
          <Form.Item
            name="name"
            label="Название"
            rules={[{ required: true, message: 'Введите название' }]}
          >
            <Input placeholder="Аренда на 1 час" />
          </Form.Item>

          <Form.Item
            name="kind"
            label="Тип"
            extra={
              editing !== null && editing !== 'new'
                ? 'Тип существующего тарифа не меняется — по нему уже могли продать аренду.'
                : 'Поминутный тариф не имеет срока; аренда — имеет.'
            }
          >
            <Segmented
              disabled={editing !== null && editing !== 'new'}
              options={[
                { label: 'Аренда', value: 'rental' },
                { label: 'Поминутный', value: 'per_minute' },
              ]}
            />
          </Form.Item>

          {kind === 'rental' ? (
            <Form.Item label="Срок аренды" required>
              <Space.Compact style={{ width: '100%' }}>
                <Form.Item
                  name="durationValue"
                  noStyle
                  rules={[{ required: true, message: 'Укажите срок' }]}
                >
                  <InputNumber min={1} max={365} style={{ width: '65%' }} />
                </Form.Item>
                <Form.Item name="durationUnit" noStyle>
                  <Select
                    style={{ width: '35%' }}
                    options={[
                      { value: 'hours', label: 'часов' },
                      { value: 'days', label: 'дней' },
                    ]}
                  />
                </Form.Item>
              </Space.Compact>
            </Form.Item>
          ) : null}

          <Form.Item
            name="price"
            label={kind === 'per_minute' ? 'Цена за минуту, so‘m' : 'Цена аренды, so‘m'}
            rules={[{ required: true, message: 'Укажите цену' }]}
          >
            <InputNumber min={0} step={1000} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="unlockFee"
            label="Плата за разблокировку, so‘m"
            extra="Обычно 0 для аренды — она уже оплачена целиком."
          >
            <InputNumber min={0} step={1000} style={{ width: '100%' }} />
          </Form.Item>

          {kind === 'rental' ? (
            <Form.Item
              name="officeOnly"
              label="Только в офисе"
              valuePropName="checked"
              extra="Включено — тариф не появится в приложении, его выдаёт оператор через «Включить аренду»."
            >
              <Switch />
            </Form.Item>
          ) : null}

          <Form.Item
            name="active"
            label="Активен"
            valuePropName="checked"
            extra="Выключенный тариф исчезает из приложения, но прошлые поездки сохраняют свою цену."
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
