import { useCallback, useEffect, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  ADMIN_SECTIONS,
  type Admin,
  type AdminAccess,
  type AdminPermissions,
  type AdminSection,
} from '@ozothunder/shared';
import { apiFetch, type ListResponse } from '../lib/api.js';
import { useAdminSession } from '../providers/session.js';
import { EmptyState, ErrorState, TableSkeleton } from '../components/states.js';

const SECTION_LABEL: Record<AdminSection, string> = {
  dashboard: 'Обзор',
  vehicles: 'Самокаты',
  rides: 'Поездки',
  subscriptions: 'Абонементы',
  users: 'Пользователи',
  plans: 'Тарифы',
  zones: 'Зоны',
  audit: 'Журнал',
  admins: 'Админы',
};

/**
 * `admins` is absent from the grid on purpose: it is the owner's screen and no
 * tick grants it, so offering the row would promise access the API refuses.
 */
const GRANTABLE = ADMIN_SECTIONS.filter((section) => section !== 'admins');

const ACCESS_LABEL: Record<AdminAccess, string> = {
  none: 'Нет',
  view: 'Просмотр',
  manage: 'Управление',
};

/**
 * The owner's screen: who else has an account, and what each of them can open.
 *
 * Permissions are per section and have three states rather than a checkbox,
 * because "can see the rides table" and "can force-end somebody's ride" are
 * different jobs and the panel has always drawn that line — it just used to
 * draw it with one role for everybody.
 *
 * There is no password reset and no invitation email. The owner sets a
 * password and says it out loud to the person it belongs to; for a back office
 * run by a handful of people who work together, that is the honest mechanism.
 */
export function AdminsPage(): React.ReactElement {
  const { message } = AntApp.useApp();
  const session = useAdminSession();
  const [items, setItems] = useState<Admin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Admin | 'new' | null>(null);
  const [permissions, setPermissions] = useState<AdminPermissions>({});
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ email: string; password: string }>();

  const load = useCallback(() => {
    apiFetch<ListResponse<Admin>>('/admin/admins')
      .then((response) => {
        setItems(response.items);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Не удалось загрузить администраторов');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(load, [load]);

  const openCreate = useCallback(() => {
    form.resetFields();
    // Nothing ticked to start with: an account that can see everything by
    // default defeats the point of the screen.
    setPermissions({});
    setEditing('new');
  }, [form]);

  const openEdit = useCallback(
    (admin: Admin) => {
      form.resetFields();
      setPermissions(admin.permissions);
      setEditing(admin);
    },
    [form],
  );

  const save = useCallback(
    async (values: { email: string; password: string }) => {
      setSaving(true);
      try {
        if (editing === 'new') {
          await apiFetch<Admin>('/admin/admins', {
            method: 'POST',
            body: JSON.stringify({
              email: values.email,
              password: values.password,
              permissions,
            }),
          });
          message.success('Администратор создан');
        } else if (editing !== null) {
          await apiFetch<Admin>(`/admin/admins/${editing.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              permissions,
              // An empty field means "leave the password alone", not "set it
              // to nothing" — editing access must not require reissuing one.
              ...(values.password ? { password: values.password } : {}),
            }),
          });
          message.success('Доступы обновлены');
        }
        setEditing(null);
        load();
      } catch (cause: unknown) {
        message.error(cause instanceof Error ? cause.message : 'Не удалось сохранить');
      } finally {
        setSaving(false);
      }
    },
    [editing, load, message, permissions],
  );

  const remove = useCallback(
    async (admin: Admin) => {
      try {
        await apiFetch(`/admin/admins/${admin.id}`, { method: 'DELETE' });
        message.success(`${admin.email} удалён`);
        load();
      } catch (cause: unknown) {
        message.error(cause instanceof Error ? cause.message : 'Не удалось удалить');
      }
    },
    [load, message],
  );

  const columns: ColumnsType<Admin> = [
    {
      title: 'Почта',
      dataIndex: 'email',
      render: (email: string, admin) => (
        <Space size={6}>
          <Typography.Text strong>{email}</Typography.Text>
          {admin.id === session.admin.id ? <Tag>это вы</Tag> : null}
        </Space>
      ),
    },
    {
      title: 'Роль',
      dataIndex: 'role',
      width: 120,
      render: (role: Admin['role']) =>
        role === 'owner' ? <Tag color="gold">Владелец</Tag> : <Tag>Сотрудник</Tag>,
    },
    {
      title: 'Доступ',
      key: 'permissions',
      render: (_, admin) =>
        admin.role === 'owner' ? (
          <Typography.Text type="secondary">Полный доступ ко всему</Typography.Text>
        ) : (
          <Space size={4} wrap>
            {GRANTABLE.filter((section) => (admin.permissions[section] ?? 'none') !== 'none').map(
              (section) => (
                <Tag
                  key={section}
                  color={admin.permissions[section] === 'manage' ? 'blue' : undefined}
                >
                  {SECTION_LABEL[section]}
                  {admin.permissions[section] === 'manage' ? ' ✎' : ''}
                </Tag>
              ),
            )}
            {GRANTABLE.every((section) => (admin.permissions[section] ?? 'none') === 'none') ? (
              <Typography.Text type="secondary">Ничего не открыто</Typography.Text>
            ) : null}
          </Space>
        ),
    },
    {
      title: '',
      key: 'actions',
      width: 90,
      render: (_, admin) =>
        // The owner is uneditable from here, including by itself — there is no
        // password reset, so locking yourself out would be unrecoverable.
        admin.role === 'owner' ? null : (
          <Space size={0}>
            <Button
              size="small"
              type="text"
              icon={<EditOutlined />}
              onClick={() => {
                openEdit(admin);
              }}
            />
            <Popconfirm
              title={`Удалить ${admin.email}?`}
              okText="Удалить"
              okButtonProps={{ danger: true }}
              cancelText="Отмена"
              onConfirm={() => void remove(admin)}
            >
              <Button size="small" type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        ),
    },
  ];

  if (error !== null) return <ErrorState message={error} onRetry={load} />;

  return (
    <Card
      size="small"
      title="Администраторы"
      extra={
        <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Добавить
        </Button>
      }
    >
      {isLoading ? (
        <TableSkeleton rows={3} />
      ) : items.length === 0 ? (
        <EmptyState description="Администраторов нет" />
      ) : (
        <Table rowKey="id" size="small" dataSource={items} columns={columns} pagination={false} />
      )}

      <Modal
        open={editing !== null}
        title={
          editing === null || editing === 'new'
            ? 'Новый администратор'
            : `Доступы — ${editing.email}`
        }
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
        width={560}
      >
        <Form form={form} layout="vertical" onFinish={(values) => void save(values)}>
          {editing === 'new' ? (
            <Form.Item
              name="email"
              label="Почта"
              rules={[{ required: true, type: 'email', message: 'Введите адрес' }]}
            >
              <Input placeholder="operator@demo.uz" autoComplete="off" />
            </Form.Item>
          ) : null}

          <Form.Item
            name="password"
            label={editing === 'new' ? 'Пароль' : 'Новый пароль'}
            extra={editing === 'new' ? null : 'Оставьте пустым, чтобы не менять'}
            rules={
              editing === 'new'
                ? [{ required: true, min: 8, message: 'Минимум 8 символов' }]
                : [{ min: 8, message: 'Минимум 8 символов' }]
            }
          >
            <Input.Password placeholder="Минимум 8 символов" autoComplete="new-password" />
          </Form.Item>

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Разделы без доступа не появятся в меню этого администратора.
          </Typography.Text>

          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            {GRANTABLE.map((section) => (
              <div
                key={section}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Typography.Text>{SECTION_LABEL[section]}</Typography.Text>
                <Radio.Group
                  size="small"
                  optionType="button"
                  buttonStyle="solid"
                  value={permissions[section] ?? 'none'}
                  onChange={(event) => {
                    const next = event.target.value as AdminAccess;
                    setPermissions((current) => {
                      const { [section]: _dropped, ...rest } = current;
                      // `none` is stored as absence, matching how the API reads
                      // it — a section added later then defaults to denied.
                      return next === 'none' ? rest : { ...rest, [section]: next };
                    });
                  }}
                  options={(['none', 'view', 'manage'] as const).map((access) => ({
                    label: ACCESS_LABEL[access],
                    value: access,
                  }))}
                />
              </div>
            ))}
          </div>
        </Form>
      </Modal>
    </Card>
  );
}
