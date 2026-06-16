import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/auth-provider';
import { QueryProvider } from '@/components/query-provider';
import { WebToastProvider } from '@/components/toast-provider';

export const metadata: Metadata = {
  manifest: '/manifest-web.json',
};

type WebLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function WebLayout({ children }: WebLayoutProps) {
  return (
    <AuthProvider>
      <QueryProvider>
        <WebToastProvider>{children}</WebToastProvider>
      </QueryProvider>
    </AuthProvider>
  );
}
