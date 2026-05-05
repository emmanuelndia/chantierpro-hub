import { redirect } from 'next/navigation';
import { MobileSiteSupervisionPage } from '@/components/mobile-site-supervision-page';
import { canAccessMobileSiteSupervision } from '@/lib/mobile-site-supervision';
import { getCurrentWebSession } from '@/lib/auth/web-session';

export default async function MobileSiteSupervisionRoutePage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  const session = await getCurrentWebSession();
  const { id } = await params;

  if (!session) {
    redirect(`/mobile/login?next=/mobile/sites/${encodeURIComponent(id)}`);
  }

  if (!canAccessMobileSiteSupervision(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileSiteSupervisionPage siteId={id} />;
}
