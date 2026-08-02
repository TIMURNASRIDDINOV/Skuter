import { Authenticated, Refine } from '@refinedev/core';
import { RefineThemes, useNotificationProvider } from '@refinedev/antd';
import routerProvider, { CatchAllNavigate, NavigateToResource } from '@refinedev/react-router';
import { App as AntApp, ConfigProvider } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { BrowserRouter, Outlet, Route, Routes } from 'react-router';
import { authProvider } from './providers/authProvider.js';
import { dataProvider } from './providers/dataProvider.js';
import { Shell } from './components/Shell.js';
import { AuditPage } from './pages/audit.js';
import { DashboardPage } from './pages/dashboard.js';
import { LoginPage } from './pages/login.js';
import { PlansPage } from './pages/plans.js';
import { RidesPage } from './pages/rides.js';
import { SubscriptionsPage } from './pages/subscriptions.js';
import { UsersPage } from './pages/users.js';
import { VehiclesPage } from './pages/vehicles.js';
import { ZonesPage } from './pages/zones.js';
import '@refinedev/antd/dist/reset.css';

export function App(): React.ReactElement {
  return (
    <BrowserRouter>
      <ConfigProvider
        locale={ruRU}
        theme={{
          ...RefineThemes.Blue,
          token: {
            ...RefineThemes.Blue.token,
            borderRadius: 4,
            fontSize: 13,
            // AntD ships 0.3s ease-in-out. Motion here is a state-change cue on
            // a self-updating panel, so it is shorter and eases out — quick to
            // start, gentle to settle.
            motionDurationFast: '0.15s',
            motionDurationMid: '0.2s',
            motionDurationSlow: '0.25s',
            motionEaseOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
            motionEaseInOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
          },
          components: {
            // Dense back office, not a landing page.
            Table: { cellPaddingBlockSM: 6, headerBg: '#fafafa' },
            Card: { bodyPadding: 12, headerHeight: 40 },
          },
        }}
      >
        <AntApp>
          <Refine
            dataProvider={dataProvider}
            authProvider={authProvider}
            routerProvider={routerProvider}
            notificationProvider={useNotificationProvider}
            resources={[
              { name: 'vehicles', list: '/vehicles', meta: { label: 'Самокаты' } },
              { name: 'rides', list: '/rides', meta: { label: 'Поездки' } },
              { name: 'subscriptions', list: '/subscriptions', meta: { label: 'Абонементы' } },
              { name: 'users', list: '/users', meta: { label: 'Пользователи' } },
              { name: 'plans', list: '/plans', meta: { label: 'Тарифы' } },
              { name: 'zones', list: '/zones', meta: { label: 'Зоны' } },
              { name: 'audit', list: '/audit', meta: { label: 'Журнал' } },
            ]}
            options={{
              syncWithLocation: true,
              warnWhenUnsavedChanges: true,
              disableTelemetry: true,
            }}
          >
            <Routes>
              <Route
                element={
                  // Must send an unauthenticated visitor to /login. Falling back
                  // to NavigateToResource would redirect into another protected
                  // route and loop, rendering nothing at all.
                  <Authenticated key="authenticated" fallback={<CatchAllNavigate to="/login" />}>
                    <Shell>
                      <Outlet />
                    </Shell>
                  </Authenticated>
                }
              >
                <Route index element={<DashboardPage />} />
                <Route path="/vehicles" element={<VehiclesPage />} />
                <Route path="/rides" element={<RidesPage />} />
                <Route path="/subscriptions" element={<SubscriptionsPage />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/plans" element={<PlansPage />} />
                <Route path="/zones" element={<ZonesPage />} />
                <Route path="/audit" element={<AuditPage />} />
              </Route>

              <Route
                element={
                  <Authenticated key="unauthenticated" fallback={<Outlet />}>
                    <NavigateToResource />
                  </Authenticated>
                }
              >
                <Route path="/login" element={<LoginPage />} />
              </Route>
            </Routes>
          </Refine>
        </AntApp>
      </ConfigProvider>
    </BrowserRouter>
  );
}
