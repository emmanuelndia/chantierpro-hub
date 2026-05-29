import { redirect } from 'next/navigation';
import { MobileSiteFormPage } from '@/components/mobile-site-form-page';
import { canAccessMobileSitesManagement } from '@/lib/mobile-sites';
import { getCurrentWebSession } from '@/lib/auth/web-session';

export default async function MobileNewSiteRoutePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/sites/new');
  }

  if (!canAccessMobileSitesManagement(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileSiteFormPage mode="create" user={session} />;
}
