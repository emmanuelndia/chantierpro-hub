'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Role } from '@prisma/client';
import { BottomTabBar } from '@/components/bottom-tab-bar';
import { MobileOfflineAutoSync } from '@/components/mobile-offline-auto-sync';
import { OfflineBanner } from '@/components/offline-banner';
import { authFetch } from '@/lib/auth/client-session';
import { getMobileOfflineCache, setMobileOfflineCache } from '@/lib/mobile-offline-db';
import { getMobileNavigationForRole } from '@/lib/navigation';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type { ClockInHistoryItem, TodayClockInView } from '@/types/clock-in';

type MobileAppShellProps = Readonly<{
  user: WebSessionUser;
  children: ReactNode;
}>;

const fieldRoles: readonly Role[] = ['SUPERVISOR', 'COORDINATOR', 'GENERAL_SUPERVISOR'];

export function MobileAppShell({ user, children }: MobileAppShellProps) {
  const tabs = getMobileNavigationForRole(user.role);
  const shouldLoadClockInBadges = fieldRoles.includes(user.role);

  const todayQuery = useQuery({
    queryKey: ['mobile-clock-in-today'],
    queryFn: async () => {
      const response = await authFetch('/api/users/me/clock-in');

      if (!response.ok) {
        return null;
      }

      return (await response.json()) as TodayClockInView;
    },
    enabled: shouldLoadClockInBadges,
    refetchInterval: 30_000,
  });

  const historyQuery = useQuery({
    queryKey: ['mobile-clock-in-history'],
    queryFn: async () => {
      try {
        const response = await authFetch('/api/users/me/clock-in/history');

        if (!response.ok) {
          throw new Error('History unavailable');
        }

        const payload = (await response.json()) as { items: ClockInHistoryItem[] };
        await setMobileOfflineCache('clock-in-history-7d', filterLastSevenDays(payload), 7 * 24 * 60 * 60 * 1000);
        return countIncompleteSessions(payload.items);
      } catch {
        const cached = await getMobileOfflineCache<{ items: ClockInHistoryItem[] }>('clock-in-history-7d');
        return cached ? countIncompleteSessions(cached.payload.items) : 0;
      }
    },
    enabled: shouldLoadClockInBadges && tabs.some((tab) => tab.href === '/mobile/history'),
    refetchInterval: 60_000,
  });

  const hasOpenSession = Boolean(todayQuery.data?.activeSession);
  const incompleteSessionCount = historyQuery.data ?? 0;

  return (
    <div className="min-h-dvh bg-[#F6F9FC] text-ink">
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-white shadow-[0_0_36px_rgba(20,34,54,0.08)]">
        <MobileOfflineAutoSync />
        <header className="border-b border-slate-200 bg-white px-5 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/70">
            ChantierPro
          </p>
          <div className="mt-2 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-ink">Mobile chantier</h1>
              <p className="mt-1 truncate text-sm text-slate-500">
                {user.firstName} {user.lastName}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              {user.role.replaceAll('_', ' ')}
            </span>
          </div>
        </header>

        <OfflineBanner />

        <main className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+6rem)] pt-4">
          {children}
        </main>

        <BottomTabBar
          hasOpenSession={hasOpenSession}
          incompleteSessionCount={incompleteSessionCount}
          tabs={tabs}
        />
      </div>
    </div>
  );
}

function filterLastSevenDays(payload: { items: ClockInHistoryItem[] }) {
  const minTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return {
    items: payload.items.filter((item) => new Date(item.timestampLocal).getTime() >= minTime),
  };
}

function countIncompleteSessions(items: ClockInHistoryItem[]) {
  const openSessionsBySite = new Map<string, number>();

  for (const item of [...items].sort((left, right) => left.timestampLocal.localeCompare(right.timestampLocal))) {
    if (item.status !== 'VALID') {
      continue;
    }

    const currentOpenCount = openSessionsBySite.get(item.siteId) ?? 0;

    if (item.type === 'ARRIVAL') {
      openSessionsBySite.set(item.siteId, currentOpenCount + 1);
      continue;
    }

    if (item.type === 'DEPARTURE' && currentOpenCount > 0) {
      openSessionsBySite.set(item.siteId, currentOpenCount - 1);
    }
  }

  return [...openSessionsBySite.values()].reduce((total, count) => total + count, 0);
}
