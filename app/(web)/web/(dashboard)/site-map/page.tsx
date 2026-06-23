import { redirect } from 'next/navigation';
import { SiteMapPage } from '@/components/site-map-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';
import { canAccessSiteMap } from '@/lib/site-map';

export default async function WebSiteMapRoutePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/web/login?next=/web/site-map');
  }

  if (!canAccessSiteMap(session.role)) {
    redirect('/settings/profil');
  }

  return <SiteMapPage surface="web" />;
}