import { AdminUserDiagnosticPage } from '@/components/admin-user-diagnostic-page';

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function AdminUserDiagnosticRoute({ params }: Props) {
  const { id } = await params;

  return <AdminUserDiagnosticPage userId={id} />;
}
