import { redirect } from 'next/navigation';
import { MobilePlanningPage } from '@/components/mobile-planning-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

export default async function MobilePlanningRoute() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/planning');
  }

  if (
    session.role !== 'GENERAL_SUPERVISOR' &&
    session.role !== 'BE_MANAGER' &&
    session.role !== 'NEGOTIATION_MANAGER' &&
    session.role !== 'FLEET_MANAGER' &&
    session.role !== 'PROJECT_MANAGER'
  ) {
    redirect('/mobile/profile');
  }

  return <MobilePlanningPage user={session} />;
}
