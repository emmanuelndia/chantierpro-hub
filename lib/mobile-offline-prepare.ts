'use client';

import { authFetch } from '@/lib/auth/client-session';
import { setMobileOfflineCache } from '@/lib/mobile-offline-db';
import {
  ensureMobileServiceWorkerRegistration,
  getMobileOfflineServiceWorkerDiagnostics,
  type MobileOfflineServiceWorkerDiagnostics,
} from '@/lib/mobile-offline-service-worker';
import type { TodayClockInView } from '@/types/clock-in';
import type { MobilePhotoSitesResponse } from '@/types/mobile-photo';
import type { PlanningDayResponse, SupervisorMyAssignmentsResponse } from '@/types/mobile-planning';
import type { MobileHistoryResponse } from '@/types/mobile-history';
import type { MobileReportsHistoryResponse } from '@/types/mobile-history-reports';
import type { TodaySiteItem } from '@/types/projects';
import type { WebSessionUser } from '@/lib/auth/web-session';

const OFFLINE_ROUTE_URLS = [
  '/app-start',
  '/mobile/home',
  '/mobile/clock-in',
  '/mobile/photo',
  '/mobile/planning',
  '/mobile/sync',
  '/mobile/history',
  '/mobile/offline',
  '/mobile/login',
  '/mobile/offline-shell',
  '/rapport-session',
];
const OFFLINE_CACHE_VERSION = 'v6';
const MOBILE_PAGE_CACHE_NAME = 'chantierpro-mobile-pages-v6';

const DAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const WEEK_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OFFLINE_USER_CACHE_KEY = 'offline-user';

type TodaySitesResponse = {
  date: string;
  items: TodaySiteItem[];
};

export type MobileOfflinePreparationResult = {
  date: string;
  preparedAt: string;
  cacheVersion: string;
  serviceWorker: MobileOfflineServiceWorkerDiagnostics;
  routesPrepared: number;
  missingRoutes: string[];
  missingData: string[];
  dataPrepared: string[];
  errors: string[];
  status: 'ready' | 'incomplete';
};

export async function prepareMobileOfflineMode() {
  const todayKey = new Date().toISOString().slice(0, 10);
  const preparedAt = new Date().toISOString();
  const errors: string[] = [];
  const dataPrepared: string[] = [];
  const registrationResult = await ensureMobileServiceWorkerRegistration();

  if (registrationResult instanceof Error) {
    errors.push(`service-worker: ${registrationResult.message}`);
  }

  await warmMobileRoutes(errors);
  await cacheOfflineUser(dataPrepared, errors);

  await cacheJson<TodaySitesResponse>('/api/users/me/sites/today', 'sites-today', DAY_CACHE_TTL_MS, dataPrepared, errors);
  await cacheJson<MobilePhotoSitesResponse>('/api/mobile/photo/sites', 'mobile-photo-sites', DAY_CACHE_TTL_MS, dataPrepared, errors);
  await cacheJson<SupervisorMyAssignmentsResponse>(
    `/api/mobile/planning/my-assignments?date=${encodeURIComponent(todayKey)}`,
    `mobile-planning-my-assignments-${todayKey}`,
    DAY_CACHE_TTL_MS,
    dataPrepared,
    errors,
  );
  await cacheJson<PlanningDayResponse>(
    `/api/mobile/planning/${encodeURIComponent(todayKey)}`,
    `planning-${todayKey}`,
    DAY_CACHE_TTL_MS,
    dataPrepared,
    errors,
    false,
  );
  await cacheJson<{ items: unknown[] }>('/api/users/me/clock-in/history', 'clock-in-history-7d', WEEK_CACHE_TTL_MS, dataPrepared, errors);
  await cacheJson<TodayClockInView>('/api/users/me/clock-in', 'clock-in-today', 30 * 60 * 1000, dataPrepared, errors);
  await cacheJson<MobileHistoryResponse>(
    '/api/mobile/history?period=week&limit=10',
    'mobile-history-week',
    WEEK_CACHE_TTL_MS,
    dataPrepared,
    errors,
  );
  await cacheJson<MobileReportsHistoryResponse>(
    '/api/mobile/history/reports?period=week&limit=10',
    'mobile-history-reports-week',
    WEEK_CACHE_TTL_MS,
    dataPrepared,
    errors,
    false,
  );
  const missingData = await getMissingPreparedData(todayKey);
  const serviceWorker = await getMobileOfflineServiceWorkerDiagnostics();
  const serviceWorkerMissingRoutes = getMissingServiceWorkerRoutes(serviceWorker);

  const result: MobileOfflinePreparationResult = {
    date: todayKey,
    preparedAt,
    cacheVersion: OFFLINE_CACHE_VERSION,
    serviceWorker,
    routesPrepared: OFFLINE_ROUTE_URLS.length - serviceWorkerMissingRoutes.length,
    missingRoutes: serviceWorkerMissingRoutes,
    missingData,
    dataPrepared,
    errors,
    status: computePreparationStatus(errors, serviceWorkerMissingRoutes, missingData, serviceWorker),
  };

  await setMobileOfflineCache('offline-preparation-meta', result, null);
  window.dispatchEvent(new Event('mobile-offline-prepared'));
  return result;
}

async function getMissingPreparedData(todayKey: string) {
  const { getMobileOfflineCache } = await import('@/lib/mobile-offline-db');
  const requiredKeys = getRequiredOfflineDataKeys(todayKey);
  const caches = await Promise.all(requiredKeys.map(async (key) => ({ key, item: await getMobileOfflineCache(key) })));
  return caches.filter(({ item }) => !item).map(({ key }) => key);
}

export async function getMobileOfflinePreparationState() {
  const todayKey = new Date().toISOString().slice(0, 10);
  const { getMobileOfflineCache } = await import('@/lib/mobile-offline-db');
  const cached = await getMobileOfflineCache<MobileOfflinePreparationResult>('offline-preparation-meta');
  const payload = cached?.payload ?? null;

  if (!payload) {
    return { status: 'missing' as const, preparation: null };
  }

  if (payload.date !== todayKey) {
    return { status: 'obsolete' as const, preparation: payload };
  }

  const serviceWorker = await getMobileOfflineServiceWorkerDiagnostics();
  const serviceWorkerMissingRoutes = getMissingServiceWorkerRoutes(serviceWorker);
  const missingData = await getMissingPreparedData(todayKey);
  const preparation = {
    ...payload,
    serviceWorker,
    missingRoutes: serviceWorkerMissingRoutes,
    missingData,
  };

  if (payload.cacheVersion !== OFFLINE_CACHE_VERSION) {
    return { status: 'incomplete' as const, preparation };
  }

  const status = computePreparationStatus(preparation.errors, preparation.missingRoutes, preparation.missingData, serviceWorker);

  return {
    status,
    preparation: {
      ...preparation,
      status,
    },
  };
}

function getRequiredOfflineDataKeys(todayKey: string) {
  return [
    OFFLINE_USER_CACHE_KEY,
    'sites-today',
    'mobile-photo-sites',
    `mobile-planning-my-assignments-${todayKey}`,
    'clock-in-history-7d',
    'clock-in-today',
    'mobile-history-week',
  ] satisfies string[];
}

async function cacheOfflineUser(dataPrepared: string[], errors: string[]) {
  try {
    const response = await authFetch('/api/auth/me');
    if (!response.ok) {
      errors.push(`${OFFLINE_USER_CACHE_KEY}: session indisponible`);
      return;
    }

    const payload = (await response.json()) as { user?: WebSessionUser | null };
    if (!payload.user) {
      errors.push(`${OFFLINE_USER_CACHE_KEY}: utilisateur manquant`);
      return;
    }

    await setMobileOfflineCache(OFFLINE_USER_CACHE_KEY, payload.user, null);
    dataPrepared.push(OFFLINE_USER_CACHE_KEY);
  } catch (error) {
    errors.push(
      `${OFFLINE_USER_CACHE_KEY}: ${error instanceof Error ? error.message : 'mise en cache impossible'}`,
    );
  }
}

function computePreparationStatus(
  errors: string[],
  missingRoutes: string[],
  missingData: string[],
  serviceWorker: MobileOfflineServiceWorkerDiagnostics,
): 'ready' | 'incomplete' {
  return errors.length === 0 &&
    missingRoutes.length === 0 &&
    missingData.length === 0 &&
    isServiceWorkerReady(serviceWorker)
    ? 'ready'
    : 'incomplete';
}

async function warmMobileRoutes(errors: string[]) {
  const pageCache = await caches.open(MOBILE_PAGE_CACHE_NAME);

  await Promise.all(
    OFFLINE_ROUTE_URLS.map(async (url) => {
      try {
        const request = new Request(url, {
          cache: 'reload',
          credentials: 'include',
          headers: {
            Accept: 'text/html',
          },
        });
        const response = await fetch(request);
        if (response.ok) {
          await pageCache.put(url, response.clone());
        } else {
          errors.push(`${url}: ${response.status}`);
        }
      } catch {
        errors.push(`${url}: navigation indisponible`);
      }
    }),
  );

}

function getMissingServiceWorkerRoutes(diagnostics: MobileOfflineServiceWorkerDiagnostics) {
  if (!diagnostics.active) {
    return [...OFFLINE_ROUTE_URLS];
  }

  return OFFLINE_ROUTE_URLS.filter(
    (url) => !diagnostics.routes.some((route) => route.url === url && route.cached),
  );
}

function isServiceWorkerReady(diagnostics: MobileOfflineServiceWorkerDiagnostics) {
  return (
    diagnostics.active &&
    diagnostics.cacheVersion === OFFLINE_CACHE_VERSION &&
    diagnostics.pageCacheName === MOBILE_PAGE_CACHE_NAME &&
    diagnostics.shellCached &&
    getMissingServiceWorkerRoutes(diagnostics).length === 0
  );
}

async function cacheJson<T>(
  url: string,
  cacheKey: string,
  ttlMs: number,
  dataPrepared: string[],
  errors: string[],
  required = true,
) {
  try {
    const response = await authFetch(url, { cache: 'no-store' });
    if (!response.ok) {
      if (required) {
        errors.push(`${cacheKey}: ${response.status}`);
      }
      return;
    }

    const payload = (await response.json()) as T;
    await setMobileOfflineCache(cacheKey, payload, ttlMs);
    dataPrepared.push(cacheKey);
  } catch {
    if (required) {
      errors.push(`${cacheKey}: donnees indisponibles`);
    }
  }
}
