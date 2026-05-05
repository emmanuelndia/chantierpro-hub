import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/auth-provider';
import { QueryProvider } from '@/components/query-provider';
import { WebToastProvider } from '@/components/toast-provider';
import { WebAppShell } from '@/components/web-app-shell';
import { getRequiredWebSession } from '@/lib/auth/web-session';

type PresencesLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default async function PresencesLayout({ children }: PresencesLayoutProps) {
  const session = await getRequiredWebSession();

  return (
    <AuthProvider>
      <QueryProvider>
        <WebToastProvider>
          <WebAppShell user={session}>{children}</WebAppShell>
        </WebToastProvider>
      </QueryProvider>
    </AuthProvider>
  );
}
