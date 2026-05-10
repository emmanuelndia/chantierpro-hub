import { WebTeamFormPage } from '@/components/web-team-form-page';

type EditTeamPageProps = Readonly<{
  params: Promise<{ id: string }>;
}>;

export default async function EditTeamPage({ params }: EditTeamPageProps) {
  const { id } = await params;

  return <WebTeamFormPage mode="edit" teamId={id} />;
}
