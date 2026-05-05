import { ReportDetailPage } from '@/components/report-detail-page';

type ReportDetailRouteProps = Readonly<{
  params: Promise<{
    id: string;
  }>;
}>;

export default async function ReportDetailRoute({ params }: ReportDetailRouteProps) {
  const { id } = await params;

  return <ReportDetailPage reportId={id} />;
}
