'use client';

import { authFetch } from '@/lib/auth/client-session';
import { setMobileOfflineCache } from '@/lib/mobile-offline-db';
import type { TodayClockInView } from '@/types/clock-in';
import type { MobilePhotoSitesResponse } from '@/types/mobile-photo';
import type { PlanningDayResponse, SupervisorMyAssignmentsResponse } from '@/types/mobile-planning';
import type { TodaySiteItem } from '@/types/projects';  

const OFFLINE_ROUTE_URLS = [
  '/mobile/home',
  '/mobile/clock-in',
  '/mobile/photo',
  '/mobile/planning',
  '/mobile/sync',
  '/mobile/history',
  '/mobile/offline',
  '/mobile/login',
  '/rapport-session',
];
const MOBILE_PAGE_CACHE_NAME = 'chantierpro-mobile-pages-v5';

const DAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const WEEK_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type TodaySitesResponse = {
  date: string;
  items: TodaySiteItem[];
};

export type MobileOfflinePreparationResult = {
  date: string;
  preparedAt: string;
  routesPrepared: number;
  missingRoutes: string[];
  dataPrepared: string[];
  errors: string[];
  status: 'ready' | 'incomplete';
};

export async function prepareMobileOfflineMode() {
  const todayKey = new Date().toISOString().slice(0, 10);
  const preparedAt = new Date().toISOString();
  const errors: string[] = [];
  const dataPrepared: string[] = [];
  await warmMobileRoutes(errors);
  const missingRoutes = await getMissingPreparedRoutes();

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

  const result: MobileOfflinePreparationResult = {
    date: todayKey,
    preparedAt,
    routesPrepared: OFFLINE_ROUTE_URLS.length - missingRoutes.length,
    missingRoutes,
    dataPrepared,
    errors,
    status: errors.length === 0 && missingRoutes.length === 0 ? 'ready' : 'incomplete',
  };

  await setMobileOfflineCache('offline-preparation-meta', result, null);
  window.dispatchEvent(new Event('mobile-offline-prepared'));
  return result;
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

  return { status: payload.status ?? (payload.errors.length === 0 ? 'ready' : 'incomplete'), preparation: payload };
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

async function getMissingPreparedRoutes() {
  const pageCache = await caches.open(MOBILE_PAGE_CACHE_NAME);
  const matches = await Promise.all(
    OFFLINE_ROUTE_URLS.map(async (url) => ({
      url,
      response: await pageCache.match(url, { ignoreSearch: true }),
    })),
  );

  return matches.filter((match) => !match.response).map((match) => match.url);
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
