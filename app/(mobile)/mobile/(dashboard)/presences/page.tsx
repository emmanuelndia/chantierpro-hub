import { redirect } from 'next/navigation';
import { MobileManagementPresencesPage } from '@/components/mobile-management-presences-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';
import { canAccessSitePresencesLive } from '@/lib/rh';

export default async function MobilePresencesRoutePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/presences');
  }

  if (!canAccessSitePresencesLive(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileManagementPresencesPage user={session} />;
}
