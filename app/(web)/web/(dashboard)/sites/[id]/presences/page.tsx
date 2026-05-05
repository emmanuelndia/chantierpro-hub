import { SitePresencesPage } from '@/components/site-presences-page';
import { getRequiredWebSession } from '@/lib/auth/web-session';

type WebSitePresencesPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>;
}>;

export default async function WebSitePresencesPage({ params }: WebSitePresencesPageProps) {
  const [{ id }, session] = await Promise.all([params, getRequiredWebSession()]);

  return (
    <SitePresencesPage
      siteId={id}
      viewer={{
        role: session.role,
      }}
    />
  );
}
