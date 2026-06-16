import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  manifest: '/manifest-mobile.json',
};

type MobileLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function MobileLayout({ children }: MobileLayoutProps) {
  return <>{children}</>;
}
