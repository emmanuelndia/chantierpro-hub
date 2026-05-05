import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobileManagementPresencesPage } from '@/components/mobile-management-presences-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const managementPresenceRoles: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION];

export default async function MobilePresencesRoutePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/presences');
  }

  if (!managementPresenceRoles.includes(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileManagementPresencesPage user={session} />;
}
