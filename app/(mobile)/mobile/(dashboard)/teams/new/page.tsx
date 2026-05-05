import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobileTeamFormPage } from '@/components/mobile-team-form-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const mobileTeamMutationRoles: readonly Role[] = [Role.GENERAL_SUPERVISOR, Role.PROJECT_MANAGER, Role.DIRECTION];

export default async function MobileNewTeamRoutePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/teams/new');
  }

  if (!mobileTeamMutationRoles.includes(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileTeamFormPage mode="create" user={session} />;
}
