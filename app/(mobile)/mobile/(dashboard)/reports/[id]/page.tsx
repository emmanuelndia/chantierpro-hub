import { redirect } from 'next/navigation';
import { MobileGeneralSupervisorReportDetailPage } from '@/components/mobile-general-supervisor-report-detail-page';
import { MobileManagementReportDetailPage } from '@/components/mobile-management-report-detail-page';
import { MobileReportDetailPage } from '@/components/mobile-report-detail-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

export default async function MobileReportDetailRoute({
  params,
}: {
  params: { id: string };
}) {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/reports/' + params.id);
  }

  if (session.role === 'COORDINATOR') {
    return <MobileReportDetailPage reportId={params.id} />;
  }

  if (session.role === 'PROJECT_MANAGER' || session.role === 'DIRECTION') {
    return <MobileManagementReportDetailPage reportId={params.id} />;
  }

  if (session.role === 'GENERAL_SUPERVISOR') {
    return <MobileGeneralSupervisorReportDetailPage reportId={params.id} />;
  }

  redirect('/mobile/profile');
}
