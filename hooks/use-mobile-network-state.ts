'use client';

import { useSyncExternalStore } from 'react';

export type MobileNetworkState = 'online' | 'degraded' | 'offline';

type NavigatorConnection = {
  effectiveType?: string;
  saveData?: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
};

export function useMobileNetworkState(): MobileNetworkState {
  return useSyncExternalStore(subscribeToNetworkState, getNetworkState, () => 'online');
}

function subscribeToNetworkState(listener: () => void) {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  window.addEventListener('visibilitychange', listener);

  const connection = getConnection();
  connection?.addEventListener?.('change', listener);

  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
    window.removeEventListener('visibilitychange', listener);
    connection?.removeEventListener?.('change', listener);
  };
}

function getNetworkState(): MobileNetworkState {
  if (!navigator.onLine) {
    return 'offline';
  }

  const connection = getConnection();
  const effectiveType = connection?.effectiveType;

  if (connection?.saveData || effectiveType === 'slow-2g' || effectiveType === '2g') {
    return 'degraded';
  }

  return 'online';
}

function getConnection() {
  return (navigator as Navigator & { connection?: NavigatorConnection }).connection;
}
