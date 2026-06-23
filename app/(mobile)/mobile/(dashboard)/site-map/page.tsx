import { redirect } from 'next/navigation';
import { SiteMapPage } from '@/components/site-map-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';
import { canAccessSiteMap } from '@/lib/site-map';

export default async function MobileSiteMapRoutePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/site-map');
  }

  if (!canAccessSiteMap(session.role)) {
    redirect('/mobile/profile');
  }

  return <SiteMapPage surface="mobile" />;
}