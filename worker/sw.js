const PRECACHE_NAME = 'chantierpro-precache-v6';
const STATIC_CACHE_NAME = 'chantierpro-static-v6';
const MOBILE_PAGE_CACHE_NAME = 'chantierpro-mobile-pages-v6';
const OFFLINE_FALLBACK_URL = '/mobile/offline';
const OFFLINE_TERRAIN_SHELL_URL = '/mobile/offline-shell';
const ESSENTIAL_MOBILE_ROUTES = [
  '/mobile/home',
  '/mobile/clock-in',
  '/mobile/photo',
  '/mobile/planning',
  '/mobile/sync',
  '/mobile/history',
  OFFLINE_FALLBACK_URL,
  OFFLINE_TERRAIN_SHELL_URL,
  '/mobile/login',
  '/rapport-session',
];
const PRECACHE_URLS = [
  ...self.__WB_MANIFEST.map((entry) => entry.url),
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  ...ESSENTIAL_MOBILE_ROUTES,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PRECACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          [...new Set(PRECACHE_URLS)].map((url) =>
            fetch(url, { credentials: 'include' }).then((response) => {
              if (response.ok) {
                return cache.put(url, response);
              }
              return undefined;
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => ![PRECACHE_NAME, STATIC_CACHE_NAME, MOBILE_PAGE_CACHE_NAME].includes(cacheName))
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === 'navigate' && (url.pathname.startsWith('/mobile/') || url.pathname === '/rapport-session')) {
    event.respondWith(networkFirstMobilePage(request));
  }
});

function isStaticAsset(pathname) {
  return (
    pathname.startsWith('/_next/static/') ||
    pathname.startsWith('/icons/') ||
    pathname === '/manifest.json'
  );
}

async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  const response = await fetch(request);

  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE_NAME);
    await cache.put(request, response.clone());
  }

  return response;
}

async function networkFirstMobilePage(request) {
  const cache = await caches.open(MOBILE_PAGE_CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    if (isOfflineTerrainRoute(new URL(request.url).pathname)) {
      const terrainShellResponse =
        (await cache.match(OFFLINE_TERRAIN_SHELL_URL)) ?? (await caches.match(OFFLINE_TERRAIN_SHELL_URL));
      if (terrainShellResponse) {
        return terrainShellResponse;
      }
    }

    const cachedResponse = await cache.match(request, { ignoreSearch: true });
    if (cachedResponse) {
      return cachedResponse;
    }

    const precachedResponse = await caches.match(request, { ignoreSearch: true });
    if (precachedResponse) {
      return precachedResponse;
    }

    const fallbackResponse = await cache.match(OFFLINE_FALLBACK_URL) ?? await caches.match(OFFLINE_FALLBACK_URL);
    if (fallbackResponse) {
      return fallbackResponse;
    }

    return new Response('ChantierPro offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

function isOfflineTerrainRoute(pathname) {
  return (
    pathname === '/mobile/home' ||
    pathname === '/mobile/clock-in' ||
    pathname === '/mobile/photo' ||
    pathname === '/mobile/history' ||
    pathname === '/mobile/sync' ||
    pathname === '/rapport-session'
  );
}
