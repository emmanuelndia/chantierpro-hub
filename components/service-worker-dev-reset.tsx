'use client';

import { useEffect } from 'react';

export function ServiceWorkerDevReset() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') {
      return;
    }

    async function resetServiceWorkers() {
      let changed = false;

      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        changed = registrations.length > 0;
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }

      if ('caches' in window) {
        const cacheNames = await window.caches.keys();
        changed = changed || cacheNames.length > 0;
        await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
      }

      if (changed && window.sessionStorage.getItem('chantierpro:dev-sw-reset:v1') !== 'done') {
        window.sessionStorage.setItem('chantierpro:dev-sw-reset:v1', 'done');
        window.location.reload();
      }
    }

    void resetServiceWorkers();
  }, []);

  return null;
}
