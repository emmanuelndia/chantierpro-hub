import { redirect } from 'next/navigation';
import { MobileFieldHomePage } from '@/components/mobile-field-home-page';
import { MobileCoordinatorHomePage } from '@/components/mobile-coordinator-home-page';
import { MobileGeneralSupervisorHomePage } from '@/components/mobile-general-supervisor-home-page';
import { MobileManagementDashboardPage } from '@/components/mobile-management-dashboard-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const fieldRoles = ['SUPERVISOR'] as const;
const generalSupervisorRoles = ['GENERAL_SUPERVISOR'] as const;
const coordinatorRoles = ['COORDINATOR'] as const;
const managementRoles = ['PROJECT_MANAGER', 'DIRECTION'] as const;

export default async function MobileHomePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/home');
  }

  if (fieldRoles.includes(session.role as (typeof fieldRoles)[number])) {
    return <MobileFieldHomePage user={session} />;
  }

  if (generalSupervisorRoles.includes(session.role as (typeof generalSupervisorRoles)[number])) {
    return <MobileGeneralSupervisorHomePage user={session} />;
  }

  if (coordinatorRoles.includes(session.role as (typeof coordinatorRoles)[number])) {
    return <MobileCoordinatorHomePage user={session} />;
  }

  if (managementRoles.includes(session.role as (typeof managementRoles)[number])) {
    return <MobileManagementDashboardPage user={session} />;
  }

  redirect('/mobile/profile');
}
