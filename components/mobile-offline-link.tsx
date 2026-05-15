'use client';

import Link, { type LinkProps } from 'next/link';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { useMobileNetworkState } from '@/hooks/use-mobile-network-state';

type MobileOfflineLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    children: ReactNode;
  };

export function MobileOfflineLink({ children, href, ...props }: MobileOfflineLinkProps) {
  const networkState = useMobileNetworkState();
  const resolvedHref = typeof href === 'string' ? href : href.pathname ?? '/';

  if (networkState === 'offline') {
    return (
      <a href={resolvedHref} {...props}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} {...props}>
      {children}
    </Link>
  );
}
