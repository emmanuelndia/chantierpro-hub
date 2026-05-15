'use client';

import { useEffect, useRef } from 'react';
import { useMobileNetworkState } from '@/hooks/use-mobile-network-state';
import { prepareMobileOfflineMode } from '@/lib/mobile-offline-prepare';

export function MobileOfflinePreparer() {
  const networkState = useMobileNetworkState();
  const runningRef = useRef(false);

  useEffect(() => {
    async function prepare() {
      if (networkState === 'offline' || runningRef.current) return;
      runningRef.current = true;
      try {
        await prepareMobileOfflineMode();
      } finally {
        runningRef.current = false;
      }
    }

    void prepare();
    const handleOnline = () => {
      void prepare();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [networkState]);

  return null;
}
