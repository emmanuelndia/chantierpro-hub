import { WebTeamDetailPage } from '@/components/web-team-detail-page';

type TeamDetailPageProps = Readonly<{
  params: Promise<{ id: string }>;
}>;

export default async function TeamDetailPage({ params }: TeamDetailPageProps) {
  const { id } = await params;

  return <WebTeamDetailPage teamId={id} />;
}
