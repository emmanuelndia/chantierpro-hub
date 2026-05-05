import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { MobileCoordinatorReportsPage } from '@/components/mobile-coordinator-reports-page';
import { MobileGeneralSupervisorReportsPage } from '@/components/mobile-general-supervisor-reports-page';
import { MobileManagementReportsPage } from '@/components/mobile-management-reports-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

export default async function MobileReportsPage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/reports');
  }

  if (session.role === 'COORDINATOR') {
    return <MobileCoordinatorReportsPage user={session} />;
  }

  if (session.role === 'GENERAL_SUPERVISOR') {
    return <MobileGeneralSupervisorReportsPage user={session} />;
  }

  if (session.role === 'PROJECT_MANAGER' || session.role === 'DIRECTION') {
    return (
      <Suspense fallback={<div className="h-32 animate-pulse rounded-lg bg-slate-100" />}>
        <MobileManagementReportsPage />
      </Suspense>
    );
  }

  redirect('/mobile/profile');
}
