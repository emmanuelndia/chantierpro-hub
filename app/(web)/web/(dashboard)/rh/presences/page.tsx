import { RhPresencesPage } from '@/components/rh-presences-page';
import { getRequiredWebSession } from '@/lib/auth/web-session';

export default async function WebRhPresencesPage() {
  const session = await getRequiredWebSession();

  return (
    <RhPresencesPage
      viewer={{
        role: session.role,
      }}
    />
  );
}
