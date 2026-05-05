import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobileSiteFormPage } from '@/components/mobile-site-form-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const mobileSitesManagementRoles: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION];

export default async function MobileEditSiteRoutePage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  const session = await getCurrentWebSession();
  const { id } = await params;

  if (!session) {
    redirect(`/mobile/login?next=${encodeURIComponent(`/mobile/sites/${id}/edit`)}`);
  }

  if (!mobileSitesManagementRoles.includes(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileSiteFormPage mode="edit" siteId={id} user={session} />;
}
