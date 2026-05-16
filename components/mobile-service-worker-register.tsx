'use client';

import { useEffect } from 'react';
import { ensureMobileServiceWorkerRegistration } from '@/lib/mobile-offline-service-worker';

export function MobileServiceWorkerRegister() {
  useEffect(() => {
    void ensureMobileServiceWorkerRegistration();
  }, []);

  return null;
}
