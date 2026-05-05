import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobileSiteFormPage } from '@/components/mobile-site-form-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const mobileSitesManagementRoles: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION];

export default async function MobileNewSiteRoutePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/sites/new');
  }

  if (!mobileSitesManagementRoles.includes(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileSiteFormPage mode="create" user={session} />;
}
