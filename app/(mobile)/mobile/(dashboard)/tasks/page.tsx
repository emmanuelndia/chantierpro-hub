import { redirect } from 'next/navigation';
import { MobileTasksPage } from '@/components/mobile-tasks-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';
import { FIELD_USER_ROLES } from '@/lib/field-roles';

export default async function MobileTasksRoute() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/tasks');
  }

  if (!FIELD_USER_ROLES.includes(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileTasksPage />;
}
