import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobileProjectFormPage } from '@/components/mobile-create-project-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const mobileProjectRoles: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION];

export default async function MobileNewProjectRoutePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/projects/new');
  }

  if (!mobileProjectRoles.includes(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileProjectFormPage mode="create" user={session} />;
}
