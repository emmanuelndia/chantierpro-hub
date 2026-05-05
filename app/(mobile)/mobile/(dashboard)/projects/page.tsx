import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobileProjectsPage } from '@/components/mobile-projects-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const mobileProjectRoles: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION];

export default async function MobileProjectsRoutePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/projects');
  }

  if (!mobileProjectRoles.includes(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileProjectsPage user={session} />;
}
