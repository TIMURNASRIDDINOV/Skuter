
import { Badge, Button, Layout, Menu, Space, Typography, theme } from 'antd';
import {
  ApiOutlined,
  AppstoreOutlined,
  CarOutlined,
  DashboardOutlined,
  EnvironmentOutlined,
  FileSearchOutlined,
  LogoutOutlined,
  SafetyCertificateOutlined,
  TagsOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useCallback, useMemo, useState } from 'react';
import { useLogout } from '@refinedev/core';
import { Link, useLocation } from 'react-router';
import type { AdminSection } from '@ozothunder/shared';
import { useAdminSession } from '../providers/session.js';
import { useLiveConnection, useServerEvents } from '../lib/events.js';
import { MotionStyles } from './motion.js';

const ITEMS: ReadonlyArray<{ key: string; section: AdminSection; icon: React.ReactNode; label: string }> = [
  { key: '/', section: 'dashboard', icon: <DashboardOutlined />, label: 'Обзор' },
  { key: '/vehicles', section: 'vehicles', icon: <CarOutlined />, label: 'Самокаты' },
  { key: '/rides', section: 'rides', icon: <ApiOutlined />, label: 'Поездки' },
  { key: '/subscriptions', section: 'subscriptions', icon: <AppstoreOutlined />, label: 'Абонементы' },
  { key: '/users', section: 'users', icon: <TeamOutlined />, label: 'Пользователи' },
  { key: '/plans', section: 'plans', icon: <TagsOutlined />, label: 'Тарифы' },
  { key: '/zones', section: 'zones', icon: <EnvironmentOutlined />, label: 'Зоны' },
  { key: '/audit', section: 'audit', icon: <FileSearchOutlined />, label: 'Журнал' },
  { key: '/admins', section: 'admins', icon: <SafetyCertificateOutlined />, label: 'Админы' },
];

/** Dense back-office chrome: fixed sider, tight header, no marketing gloss. */
export function Shell({ children }: { children: React.ReactNode }): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const { mutate: logout } = useLogout();
  const location = useLocation();
  const connected = useLiveConnection();
  const { token } = theme.useToken();
  const session = useAdminSession();

  // A section this admin cannot open is absent, not disabled. A greyed-out row
  // still tells them the screen exists and invites a support call about it.
  const items = useMemo(
    () =>
      ITEMS.filter((item) =>
        item.section === 'admins' ? session.isOwner : session.can(item.section),
      ),
    [session],
  );

  // The shell holds a subscription for as long as the panel is mounted. The
  // stream is reference-counted, so without this it closes on any page that
  // does not consume events (Zones, Plans) and the header indicator below
  // would claim to be reconnecting when nothing was actually wrong.
  useServerEvents(useCallback(() => undefined, []));

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <MotionStyles />
      <Layout.Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="light"
        width={200}
      >
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            fontWeight: 600,
            fontSize: 16,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {collapsed ? 'O' : 'Ozo Thunder'}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          style={{ borderInlineEnd: 'none' }}
          items={items.map((item) => ({
            key: item.key,
            icon: item.icon,
            label: <Link to={item.key}>{item.label}</Link>,
          }))}
        />
      </Layout.Sider>

      <Layout>
        <Layout.Header
          style={{
            background: token.colorBgContainer,
            padding: '0 16px',
            height: 48,
            lineHeight: '48px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Typography.Text strong>
            {items.find((item) => item.key === location.pathname)?.label ?? 'Ozo Thunder'}
          </Typography.Text>

          <Space size={16}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {session.admin.email}
              {session.isOwner ? ' · владелец' : ''}
            </Typography.Text>
            <Badge
              status={connected ? 'processing' : 'default'}
              text={
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {connected ? 'Данные в реальном времени' : 'Переподключение…'}
                </Typography.Text>
              }
            />
            <Button
              size="small"
              type="text"
              icon={<LogoutOutlined />}
              onClick={() => {
                logout();
              }}
            >
              Выйти
            </Button>
          </Space>
        </Layout.Header>

        <Layout.Content style={{ padding: 12, background: '#f5f5f5' }}>{children}</Layout.Content>
      </Layout>
    </Layout>
  );
}
