import { redirect } from 'next/navigation';
import { MobileClockInPage } from '@/components/mobile-clock-in-page';
import { getCurrentWebSession } from '@/lib/auth/web-session';

export default async function MobileClockInRoutePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/clock-in');
  }

  return <MobileClockInPage userRole={session.role} />;
}
