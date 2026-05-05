import type { ReactNode } from 'react';

type MobileLayoutProps = Readonly<{
  children: ReactNode;
}>;

export default function MobileLayout({ children }: MobileLayoutProps) {
  return <>{children}</>;
}
