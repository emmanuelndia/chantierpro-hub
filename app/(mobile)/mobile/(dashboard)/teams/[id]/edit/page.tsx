import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobileTeamFormPage } from '@/components/mobile-team-form-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const mobileTeamMutationRoles: readonly Role[] = [Role.GENERAL_SUPERVISOR, Role.PROJECT_MANAGER, Role.DIRECTION];

export default async function MobileEditTeamRoutePage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  const session = await getCurrentWebSession();
  const { id } = await params;

  if (!session) {
    redirect(`/mobile/login?next=${encodeURIComponent(`/mobile/teams/${id}/edit`)}`);
  }

  if (!mobileTeamMutationRoles.includes(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileTeamFormPage mode="edit" teamId={id} user={session} />;
}
