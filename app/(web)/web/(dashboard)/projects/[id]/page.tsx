import { ProjectDetailPage } from '@/components/project-detail-page';
import { getRequiredWebSession } from '@/lib/auth/web-session';

type WebProjectDetailPageProps = Readonly<{
  params: Promise<{
    id: string;
  }>;
}>;

export default async function WebProjectDetailPage({ params }: WebProjectDetailPageProps) {
  const [{ id }, session] = await Promise.all([params, getRequiredWebSession()]);

  return (
    <ProjectDetailPage
      projectId={id}
      viewer={{
        id: session.id,
        role: session.role,
      }}
    />
  );
}
