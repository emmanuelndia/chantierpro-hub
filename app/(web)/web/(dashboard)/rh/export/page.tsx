import { RhExportPage } from '@/components/rh-export-page';
import { getRequiredWebSession } from '@/lib/auth/web-session';

export default async function WebRhExportPage() {
  const session = await getRequiredWebSession();

  return (
    <RhExportPage
      viewer={{
        role: session.role,
      }}
    />
  );
}
