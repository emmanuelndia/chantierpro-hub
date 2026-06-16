'use client';

import { useMobileNetworkState } from '@/hooks/use-mobile-network-state';

export function OfflineBanner() {
  const networkState = useMobileNetworkState();

  if (networkState !== 'degraded') {
    return null;
  }

  return (
    <div className="border-b border-yellow-300 bg-yellow-100 px-4 py-2 text-center text-sm font-semibold text-yellow-900">
      Connexion degradee
    </div>
  );
}
