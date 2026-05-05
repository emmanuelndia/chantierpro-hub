import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobileTeamDetailPage } from '@/components/mobile-team-detail-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const mobileTeamRoles: readonly Role[] = [
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
];

export default async function MobileTeamDetailRoutePage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  const session = await getCurrentWebSession();
  const { id } = await params;

  if (!session) {
    redirect(`/mobile/login?next=${encodeURIComponent(`/mobile/teams/${id}`)}`);
  }

  if (!mobileTeamRoles.includes(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileTeamDetailPage teamId={id} />;
}
