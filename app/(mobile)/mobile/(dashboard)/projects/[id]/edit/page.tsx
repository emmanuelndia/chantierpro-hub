import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobileProjectFormPage } from '@/components/mobile-create-project-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const mobileProjectRoles: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION];

export default async function MobileEditProjectRoutePage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  const session = await getCurrentWebSession();
  const { id } = await params;

  if (!session) {
    redirect(`/mobile/login?next=${encodeURIComponent(`/mobile/projects/${id}/edit`)}`);
  }

  if (!mobileProjectRoles.includes(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileProjectFormPage mode="edit" projectId={id} user={session} />;
}
