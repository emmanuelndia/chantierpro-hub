import { ResourceAssignmentsHistoryPage } from '@/components/resource-assignments-history-page';

type UserAssignmentsHistoryRouteProps = Readonly<{
  params: Promise<{
    id: string;
  }>;
}>;

export default async function UserAssignmentsHistoryRoute({ params }: UserAssignmentsHistoryRouteProps) {
  const { id } = await params;

  return <ResourceAssignmentsHistoryPage userId={id} />;
}
