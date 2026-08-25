import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Spin } from 'antd';
import {
  adminCan,
  type Admin,
  type AdminAccess,
  type AdminSection,
} from '@ozothunder/shared';
import { apiFetch } from '../lib/api.js';

/**
 * Who is signed in, and what they are allowed to see.
 *
 * One fetch of `/admin/auth/me` for the whole session, held here rather than
 * asked for per page — the sidebar, the router and every action button need
 * the same answer, and asking Refine's `getIdentity` from each of them would
 * make the menu flicker as separate requests resolve.
 *
 * The decision itself is `adminCan` from `@ozothunder/shared`, which is also what
 * the API's `requirePermission` middleware calls. That is deliberate: a button
 * this file hides is a request the API refuses, and there is no second copy of
 * the rule to fall out of step.
 */
interface AdminSessionValue {
  admin: Admin;
  /** `manage` implies `view`; the owner passes everything. */
  can: (section: AdminSection, level?: Exclude<AdminAccess, 'none'>) => boolean;
  isOwner: boolean;
}

const AdminSessionContext = createContext<AdminSessionValue | null>(null);

export function AdminSessionProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [admin, setAdmin] = useState<Admin | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<Admin>('/admin/auth/me')
      .then((next) => {
        if (!cancelled) setAdmin(next);
      })
      .catch(() => {
        // `<Authenticated>` above us already redirects on a dead token; there
        // is nothing useful to render or retry here.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AdminSessionValue | null>(
    () =>
      admin === null
        ? null
        : {
            admin,
            can: (section, level = 'view') => adminCan(admin, section, level),
            isOwner: admin.role === 'owner',
          },
    [admin],
  );

  // Rendering the panel before permissions arrive would show every section for
  // a beat and then take some away, which reads as a glitch and briefly shows
  // an operator the existence of screens they cannot open.
  if (value === null) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <Spin />
      </div>
    );
  }

  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export function useAdminSession(): AdminSessionValue {
  const value = useContext(AdminSessionContext);
  if (value === null) {
    throw new Error('useAdminSession must be used inside <AdminSessionProvider>');
  }
  return value;
}
