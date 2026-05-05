import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobilePhotoGalleryPage } from '@/components/mobile-photo-gallery-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const mobileGalleryRoles: readonly Role[] = [
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
  Role.ADMIN,
  Role.GENERAL_SUPERVISOR,
  Role.COORDINATOR,
];

const mobileCameraRoles: readonly Role[] = [
  Role.SUPERVISOR,
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
];

const mobileCameraFabRoles: readonly Role[] = [
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
  Role.ADMIN,
  Role.GENERAL_SUPERVISOR,
  Role.COORDINATOR,
];

export default async function MobileGalleryRoutePage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ siteId?: string }>;
}>) {
  const session = await getCurrentWebSession();
  const params = await searchParams;
  const nextPath = params.siteId
    ? `/mobile/gallery?siteId=${encodeURIComponent(params.siteId)}`
    : '/mobile/gallery';

  if (!session) {
    redirect(`/mobile/login?next=${encodeURIComponent(nextPath)}`);
  }

  if (mobileCameraRoles.includes(session.role)) {
    const photoPath = params.siteId
      ? `/mobile/photo?siteId=${encodeURIComponent(params.siteId)}`
      : '/mobile/photo';
    redirect(photoPath);
  }

  if (!mobileGalleryRoles.includes(session.role)) {
    redirect('/mobile/profile');
  }

  return (
    <MobilePhotoGalleryPage 
      initialSiteId={params.siteId ?? null} 
      canShowCameraFab={mobileCameraFabRoles.includes(session.role)}
    />
  );
}
