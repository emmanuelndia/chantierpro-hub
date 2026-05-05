import { ProjectsListPage } from '@/components/projects-list-page';
import { getRequiredWebSession } from '@/lib/auth/web-session';

export default async function WebProjectsPage() {
  const session = await getRequiredWebSession();

  return (
    <ProjectsListPage
      scope="all"
      viewer={{
        id: session.id,
        role: session.role,
        firstName: session.firstName,
        lastName: session.lastName,
      }}
    />
  );
}
