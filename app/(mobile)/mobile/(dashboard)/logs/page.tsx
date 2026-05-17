import { Role } from '@prisma/client';
import { redirect } from 'next/navigation';
import { MobileAdminLogsPage } from '@/components/mobile-admin-logs-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

export default async function MobileLogsRoutePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/logs');
  }

  if (session.role !== Role.ADMIN) {
    redirect('/mobile/profile');
  }

  return <MobileAdminLogsPage />;
}
