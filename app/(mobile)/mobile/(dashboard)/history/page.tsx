import { redirect } from 'next/navigation';
import { MobileHistoryPage } from '@/components/mobile-history-page';
import { canAccessMobileHistory } from '@/lib/mobile-history';
import { getCurrentWebSession } from '@/lib/auth/web-session';

export default async function MobileHistoryRoutePage() {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login?next=/mobile/history');
  }

  if (!canAccessMobileHistory(session.role)) {
    redirect('/mobile/profile');
  }

  return <MobileHistoryPage />;
}
