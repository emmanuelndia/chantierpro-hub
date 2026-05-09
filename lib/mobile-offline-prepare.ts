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
];

const DAY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const WEEK_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type TodaySitesResponse = {
  date: string;
  items: TodaySiteItem[];
};

export type MobileOfflinePreparationResult = {
  preparedAt: string;
  routesPrepared: number;
  dataPrepared: string[];
  errors: string[];
};

export async function prepareMobileOfflineMode() {
  const todayKey = new Date().toISOString().slice(0, 10);
  const preparedAt = new Date().toISOString();
  const errors: string[] = [];
  const dataPrepared: string[] = [];
  const routesPrepared = await warmMobileRoutes(errors);

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
  );
  await cacheJson<{ items: unknown[] }>('/api/users/me/clock-in/history', 'clock-in-history-7d', WEEK_CACHE_TTL_MS, dataPrepared, errors);
  await cacheJson<TodayClockInView>('/api/users/me/clock-in', 'clock-in-today', 30 * 60 * 1000, dataPrepared, errors);

  const result: MobileOfflinePreparationResult = {
    preparedAt,
    routesPrepared,
    dataPrepared,
    errors,
  };

  await setMobileOfflineCache('offline-preparation-meta', result, null);
  return result;
}

async function warmMobileRoutes(errors: string[]) {
  let prepared = 0;

  await Promise.all(
    OFFLINE_ROUTE_URLS.map(async (url) => {
      try {
        const response = await fetch(url, {
          cache: 'reload',
          credentials: 'include',
        });
        if (response.ok) {
          prepared += 1;
        } else {
          errors.push(`${url}: ${response.status}`);
        }
      } catch {
        errors.push(`${url}: navigation indisponible`);
      }
    }),
  );

  return prepared;
}

async function cacheJson<T>(
  url: string,
  cacheKey: string,
  ttlMs: number,
  dataPrepared: string[],
  errors: string[],
) {
  try {
    const response = await authFetch(url, { cache: 'no-store' });
    if (!response.ok) {
      errors.push(`${cacheKey}: ${response.status}`);
      return;
    }

    const payload = (await response.json()) as T;
    await setMobileOfflineCache(cacheKey, payload, ttlMs);
    dataPrepared.push(cacheKey);
  } catch {
    errors.push(`${cacheKey}: donnees indisponibles`);
  }
}
