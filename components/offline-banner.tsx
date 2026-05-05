'use client';

import { useMobileNetworkState } from '@/hooks/use-mobile-network-state';

export function OfflineBanner() {
  const networkState = useMobileNetworkState();

  if (networkState === 'online') {
    return null;
  }

  const offline = networkState === 'offline';

  return (
    <div
      className={`border-b px-4 py-2 text-center text-sm font-semibold ${
        offline
          ? 'border-orange-300 bg-orange-100 text-orange-900'
          : 'border-yellow-300 bg-yellow-100 text-yellow-900'
      }`}
    >
      {offline ? 'Mode hors ligne' : 'Connexion degradee'}
    </div>
  );
}
