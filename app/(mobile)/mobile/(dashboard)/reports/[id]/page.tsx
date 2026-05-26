import { redirect } from 'next/navigation';
import { MobileGeneralSupervisorReportDetailPage } from '@/components/mobile-general-supervisor-report-detail-page';
import { MobileManagementReportDetailPage } from '@/components/mobile-management-report-detail-page';
import { MobileReportDetailPage } from '@/components/mobile-report-detail-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

export default async function MobileReportDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/reports/' + id);
  }

  if (session.role === 'COORDINATOR') {
    return <MobileReportDetailPage reportId={id} />;
  }

  if (session.role === 'PROJECT_MANAGER' || session.role === 'DIRECTION') {
    return <MobileManagementReportDetailPage reportId={id} />;
  }

  if (
    session.role === 'GENERAL_SUPERVISOR' ||
    session.role === 'BE_MANAGER' ||
    session.role === 'NEGOTIATION_MANAGER' ||
    session.role === 'FLEET_MANAGER'
  ) {
    return <MobileGeneralSupervisorReportDetailPage reportId={id} />;
  }

  redirect('/mobile/profile');
}
