import type { ReactNode } from 'react';
import { WebAppShell } from '@/components/web-app-shell';
import { getRequiredWebSession } from '@/lib/auth/web-session';

type WebDashboardLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function WebDashboardLayout({ children }: WebDashboardLayoutProps) {
  const session = await getRequiredWebSession();

  return <WebAppShell user={session}>{children}</WebAppShell>;
}
