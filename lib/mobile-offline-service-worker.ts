'use client';

export type MobileOfflineServiceWorkerRoute = {
  url: string;
  cached: boolean;
};

export type MobileOfflineServiceWorkerDiagnostics = {
  active: boolean;
  registrationError: string | null;
  cacheVersion: string | null;
  pageCacheName: string | null;
  shellCached: boolean;
  routes: MobileOfflineServiceWorkerRoute[];
};

type ServiceWorkerDiagnosticsMessage = {
  type: 'OFFLINE_DIAGNOSTICS';
  cacheVersion: string;
  pageCacheName: string;
  shellCached: boolean;
  routes: MobileOfflineServiceWorkerRoute[];
};

export async function getMobileOfflineServiceWorkerDiagnostics(): Promise<MobileOfflineServiceWorkerDiagnostics> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return inactiveDiagnostics();
  }

  const registration = await navigator.serviceWorker.getRegistration();
  const worker = navigator.serviceWorker.controller ?? registration?.active ?? null;

  if (!worker) {
    return inactiveDiagnostics();
  }

  try {
    const diagnostics = await sendDiagnosticsRequest(worker);
    return {
      active: true,
      registrationError: null,
      cacheVersion: diagnostics.cacheVersion,
      pageCacheName: diagnostics.pageCacheName,
      shellCached: diagnostics.shellCached,
      routes: diagnostics.routes,
    };
  } catch {
    return {
      ...inactiveDiagnostics(),
      active: true,
    };
  }
}

export async function ensureMobileServiceWorkerRegistration() {
  if (typeof window === 'undefined' || process.env.NODE_ENV === 'development' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const existing = await navigator.serviceWorker.getRegistration('/');
    const registration = existing ?? (await navigator.serviceWorker.register('/sw.js', { scope: '/' }));
    await navigator.serviceWorker.ready;
    window.dispatchEvent(new Event('mobile-service-worker-ready'));
    return registration;
  } catch (error) {
    window.dispatchEvent(new Event('mobile-service-worker-error'));
    return error instanceof Error ? error : new Error('Service worker registration failed.');
  }
}

function sendDiagnosticsRequest(worker: ServiceWorker) {
  return new Promise<ServiceWorkerDiagnosticsMessage>((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      reject(new Error('Service worker diagnostics timeout.'));
    }, 1500);

    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      window.clearTimeout(timeout);

      if (isDiagnosticsMessage(event.data)) {
        resolve(event.data);
        return;
      }

      reject(new Error('Invalid service worker diagnostics response.'));
    };

    worker.postMessage({ type: 'GET_OFFLINE_DIAGNOSTICS' }, [channel.port2]);
  });
}

function inactiveDiagnostics(): MobileOfflineServiceWorkerDiagnostics {
  return {
    active: false,
    registrationError: null,
    cacheVersion: null,
    pageCacheName: null,
    shellCached: false,
    routes: [],
  };
}

function isDiagnosticsMessage(value: unknown): value is ServiceWorkerDiagnosticsMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'OFFLINE_DIAGNOSTICS' &&
    'cacheVersion' in value &&
    typeof value.cacheVersion === 'string' &&
    'pageCacheName' in value &&
    typeof value.pageCacheName === 'string' &&
    'shellCached' in value &&
    typeof value.shellCached === 'boolean' &&
    'routes' in value &&
    Array.isArray(value.routes)
  );
}
