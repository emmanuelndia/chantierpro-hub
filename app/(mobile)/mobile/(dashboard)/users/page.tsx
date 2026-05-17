import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobileAdminUsersPage } from '@/components/mobile-admin-users-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

export default async function MobileUsersRoutePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/users');
  }

  if (session.role !== Role.ADMIN) {
    redirect('/mobile/profile');
  }

  return <MobileAdminUsersPage />;
}
