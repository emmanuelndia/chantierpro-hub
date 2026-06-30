'use client';

import type { QueryClient } from '@tanstack/react-query';
import { clearAccessToken } from '@/lib/auth/client-session';
import { clearMobileOfflineStorage } from '@/lib/mobile-offline-db';

export async function clearClientSessionState(queryClient?: QueryClient) {
  clearAccessToken();
  queryClient?.clear();

  if (typeof window !== 'undefined') {
    window.sessionStorage.clear();
  }

  await clearMobileOfflineStorage();
}