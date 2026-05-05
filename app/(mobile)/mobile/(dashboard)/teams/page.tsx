import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobileTeamsManagementPage } from '@/components/mobile-teams-management-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const mobileTeamRoles: readonly Role[] = [
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
];

export default async function MobileTeamsRoutePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/teams');
  }

  if (!mobileTeamRoles.includes(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileTeamsManagementPage user={session} />;
}
