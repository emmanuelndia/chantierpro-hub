import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/auth-provider';
import { QueryProvider } from '@/components/query-provider';
import { WebToastProvider } from '@/components/toast-provider';

type MobileRouteGroupLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function MobileRouteGroupLayout({ children }: MobileRouteGroupLayoutProps) {
  return (
    <AuthProvider>
      <QueryProvider>
        <WebToastProvider>{children}</WebToastProvider>
      </QueryProvider>
    </AuthProvider>
  );
}
