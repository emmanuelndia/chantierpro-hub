import { GeneralSupervisorScopesWebPage } from '@/components/general-supervisor-scopes-web-page';
import { getRequiredWebSession } from '@/lib/auth/web-session';

export default async function WebSupervisorScopesPage() {
  const session = await getRequiredWebSession();

  return (
    <GeneralSupervisorScopesWebPage
      viewer={{
        role: session.role,
      }}
    />
  );
}
