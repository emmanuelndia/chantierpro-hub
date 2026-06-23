import { redirect } from 'next/navigation';
import { MobileSiteFormPage } from '@/components/mobile-site-form-page';
import { canMutateMobileSitesManagement } from '@/lib/mobile-sites';
import { getCurrentWebSession } from '@/lib/auth/web-session';

export default async function MobileNewSiteRoutePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/sites/new');
  }

  if (!canMutateMobileSitesManagement(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileSiteFormPage mode="create" user={session} />;
}
