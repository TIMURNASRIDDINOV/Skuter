import { Authenticated, Refine } from '@refinedev/core';
import { RefineThemes, useNotificationProvider } from '@refinedev/antd';
import routerProvider, { CatchAllNavigate, NavigateToResource } from '@refinedev/react-router';
import { App as AntApp, ConfigProvider } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { BrowserRouter, Outlet, Route, Routes } from 'react-router';
import { authProvider } from './providers/authProvider.js';
import { dataProvider } from './providers/dataProvider.js';
import { AdminSessionProvider } from './providers/session.js';
import { RequireSection } from './components/RequireSection.js';
import { Shell } from './components/Shell.js';
import { AdminsPage } from './pages/admins.js';
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
            // AntD tints the whole sorted column. On a table sorted by default
            // that paints a grey stripe down a column of no special importance,
            // pulling the eye away from the data that matters.
            Table: {
              cellPaddingBlockSM: 6,
              headerBg: '#fafafa',
              bodySortBg: 'transparent',
              headerSortActiveBg: '#fafafa',
              headerSortHoverBg: '#f0f0f0',
            },
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
              { name: 'admins', list: '/admins', meta: { label: 'Админы' } },
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
                    {/* Permissions load once here, above the shell, so the
                        sidebar and every route below decide from one answer. */}
                    <AdminSessionProvider>
                      <Shell>
                        <Outlet />
                      </Shell>
                    </AdminSessionProvider>
                  </Authenticated>
                }
              >
                <Route
                  index
                  element={
                    <RequireSection section="dashboard">
                      <DashboardPage />
                    </RequireSection>
                  }
                />
                <Route
                  path="/vehicles"
                  element={
                    <RequireSection section="vehicles">
                      <VehiclesPage />
                    </RequireSection>
                  }
                />
                <Route
                  path="/rides"
                  element={
                    <RequireSection section="rides">
                      <RidesPage />
                    </RequireSection>
                  }
                />
                <Route
                  path="/subscriptions"
                  element={
                    <RequireSection section="subscriptions">
                      <SubscriptionsPage />
                    </RequireSection>
                  }
                />
                <Route
                  path="/users"
                  element={
                    <RequireSection section="users">
                      <UsersPage />
                    </RequireSection>
                  }
                />
                <Route
                  path="/plans"
                  element={
                    <RequireSection section="plans">
                      <PlansPage />
                    </RequireSection>
                  }
                />
                <Route
                  path="/zones"
                  element={
                    <RequireSection section="zones">
                      <ZonesPage />
                    </RequireSection>
                  }
                />
                <Route
                  path="/audit"
                  element={
                    <RequireSection section="audit">
                      <AuditPage />
                    </RequireSection>
                  }
                />
                <Route
                  path="/admins"
                  element={
                    <RequireSection section="admins" owner>
                      <AdminsPage />
                    </RequireSection>
                  }
                />
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
