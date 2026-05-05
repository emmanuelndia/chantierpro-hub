'use client';

import { useEffect } from 'react';
import { useMobileNetworkState } from '@/hooks/use-mobile-network-state';
import { syncMobileOfflineQueue } from '@/lib/mobile-offline-db';

export function MobileOfflineAutoSync() {
  const networkState = useMobileNetworkState();

  useEffect(() => {
    if (networkState !== 'offline') {
      void syncMobileOfflineQueue({ mode: 'auto' });
    }
  }, [networkState]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void syncMobileOfflineQueue({ mode: 'auto' });
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  return null;
}
