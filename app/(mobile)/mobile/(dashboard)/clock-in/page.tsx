import { redirect } from 'next/navigation';
import { MobileClockInPage } from '@/components/mobile-clock-in-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

const fieldRoles = ['SUPERVISOR', 'COORDINATOR', 'GENERAL_SUPERVISOR'] as const;

export default async function MobileClockInRoutePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/clock-in');
  }

  if (!fieldRoles.includes(session.role as (typeof fieldRoles)[number])) {
    redirect('/mobile/profile');
  }

  return <MobileClockInPage />;
}
