import { redirect } from 'next/navigation';
import { MobilePlanningPage } from '@/components/mobile-planning-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

export default async function MobilePlanningRoute() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/planning');
  }

  if (session.role !== 'GENERAL_SUPERVISOR') {
    redirect('/mobile/profile');
  }

  return <MobilePlanningPage user={session} />;
}
