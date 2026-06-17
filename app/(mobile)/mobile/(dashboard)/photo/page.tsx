import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobilePhotoCameraPage } from '@/components/mobile-photo-camera-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const mobileCameraRoles: readonly Role[] = [
  Role.SUPERVISOR,
  Role.RESOURCE,
  Role.EXTERNAL_RESOURCE,
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
  Role.BE_RESOURCE,
  Role.NEGOTIATION_RESOURCE,
  Role.NEGOTIATION_MANAGER,
  Role.FLEET_RESOURCE,
  Role.PROJECT_MANAGER,
];

export default async function MobilePhotoPage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/photo');
  }

  if (session.role === Role.DIRECTION) {
    redirect('/mobile/gallery');
  }

  if (!mobileCameraRoles.includes(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobilePhotoCameraPage />;
}
