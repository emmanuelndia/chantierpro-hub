import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobileSitesManagementPage } from '@/components/mobile-sites-management-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const mobileSitesManagementRoles: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION];

export default async function MobileSitesManagementRoutePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/sites');
  }

  if (!mobileSitesManagementRoles.includes(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileSitesManagementPage user={session} />;
}
