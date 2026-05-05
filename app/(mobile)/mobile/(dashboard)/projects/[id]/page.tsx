import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobileProjectDetailPage } from '@/components/mobile-project-detail-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const mobileProjectRoles: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION];

export default async function MobileProjectDetailRoutePage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  const session = await getCurrentWebSession();
  const { id } = await params;

  if (!session) {
    redirect(`/mobile/login?next=${encodeURIComponent(`/mobile/projects/${id}`)}`);
  }

  if (!mobileProjectRoles.includes(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileProjectDetailPage projectId={id} />;
}
