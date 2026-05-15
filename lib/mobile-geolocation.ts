'use client';

import { getMobileOfflineCache, setMobileOfflineCache } from '@/lib/mobile-offline-db';

const LAST_POSITION_KEY = 'last-known-position';
const MAX_CACHED_POSITION_AGE_MS = 15 * 60 * 1000;

export type MobileGpsPosition = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string;
  source: 'LIVE' | 'CACHED';
};

export async function rememberMobileGpsPosition(position: Omit<MobileGpsPosition, 'source'>) {
  await setMobileOfflineCache(LAST_POSITION_KEY, { ...position, source: 'LIVE' as const }, null);
}

export async function getRecentMobileGpsPosition() {
  const cached = await getMobileOfflineCache<MobileGpsPosition>(LAST_POSITION_KEY);
  const position = cached?.payload ?? null;

  if (!position) {
    return null;
  }

  if (Date.now() - new Date(position.capturedAt).getTime() > MAX_CACHED_POSITION_AGE_MS) {
    return null;
  }

  return { ...position, source: 'CACHED' as const };
}
