import { CoordinatorProjectManagerScopesPage } from '@/components/coordinator-project-manager-scopes-page';
import { getRequiredWebSession } from '@/lib/auth/web-session';

export default async function WebCoordinatorScopesPage() {
  const session = await getRequiredWebSession();

  return (
    <CoordinatorProjectManagerScopesPage
      viewer={{
        role: session.role,
      }}
    />
  );
}
