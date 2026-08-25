import { Navigate } from 'react-router';
import { Result } from 'antd';
import { ADMIN_SECTIONS, type AdminSection } from '@ozothunder/shared';
import { useAdminSession } from '../providers/session.js';

/** Where the sidebar sends each section. Also the redirect table below. */
export const SECTION_PATHS: Record<AdminSection, string> = {
  dashboard: '/',
  vehicles: '/vehicles',
  rides: '/rides',
  subscriptions: '/subscriptions',
  users: '/users',
  plans: '/plans',
  zones: '/zones',
  audit: '/audit',
  admins: '/admins',
};

/**
 * Guards a route on a section the signed-in admin can actually open.
 *
 * A section they lack is a redirect, not a "no access" page: it is absent from
 * their menu, so the only way to land on one is a stale bookmark or a link
 * from somebody with wider access, and in both cases the useful answer is the
 * first screen they *can* see.
 */
export function RequireSection({
  section,
  owner = false,
  children,
}: {
  section: AdminSection;
  /** For the admins screen, which no permission grants — only the owner. */
  owner?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  const session = useAdminSession();
  const allowed = owner ? session.isOwner : session.can(section);
  if (allowed) return <>{children}</>;

  const fallback = firstVisibleSection(session);

  // An account with nothing ticked has nowhere to be sent, and redirecting it
  // to a section it also cannot open would loop between two guards forever.
  // Say so instead — it is a real state, and the answer is to ask the owner.
  if (fallback === null) {
    return (
      <Result
        status="403"
        title="Доступ не настроен"
        subTitle="Этой учётной записи пока не открыт ни один раздел. Обратитесь к владельцу панели."
      />
    );
  }

  return <Navigate to={fallback} replace />;
}

/**
 * The landing page for this admin — their first visible section in sidebar
 * order, or null when an owner has given them an account and no access.
 */
export function firstVisibleSection(
  session: ReturnType<typeof useAdminSession>,
): string | null {
  for (const section of ADMIN_SECTIONS) {
    if (section === 'admins' ? session.isOwner : session.can(section)) {
      return SECTION_PATHS[section];
    }
  }
  return null;
}
