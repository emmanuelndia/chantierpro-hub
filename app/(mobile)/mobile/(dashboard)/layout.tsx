import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { MobileAppShell } from '@/components/mobile-app-shell';
import { getCurrentWebSession } from '@/lib/auth/web-session';

type MobileDashboardLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function MobileDashboardLayout({ children }: MobileDashboardLayoutProps) {
  const session = await getCurrentWebSession();

  if (!session) {
    redirect('/mobile/login');
  }

  return <MobileAppShell user={session}>{children}</MobileAppShell>;
}
