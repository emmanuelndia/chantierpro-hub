import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobileGeneralSupervisorScopesPage } from '@/components/mobile-general-supervisor-scopes-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const scopeManagementRoles: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION, Role.ADMIN];

export default async function MobileGeneralSupervisorScopesRoute() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/supervisor-scopes');
  }

  if (!scopeManagementRoles.includes(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileGeneralSupervisorScopesPage user={session} />;
}
