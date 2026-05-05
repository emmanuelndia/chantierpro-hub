import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobileCameraManagementPage } from '@/components/mobile-camera-management-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const mobileCameraManagementRoles: readonly Role[] = [
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
];

export default async function MobileCameraManagementPage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/camera-management');
  }

  if (!mobileCameraManagementRoles.includes(session.role)) {
    redirect('/mobile/photo');
  }

  return <MobileCameraManagementPage />;
}
