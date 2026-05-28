import { RhSitePresencesLivePage } from '@/components/rh-site-presences-live-page';
import { getRequiredWebSession } from '@/lib/auth/web-session';

export default async function WebRhSitePresencesLivePage() {
  const session = await getRequiredWebSession();

  return (
    <RhSitePresencesLivePage
      viewer={{
        role: session.role,
      }}
    />
  );
}
