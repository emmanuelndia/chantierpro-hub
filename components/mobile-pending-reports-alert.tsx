'use client';

import { useQuery } from '@tanstack/react-query';
import { MobileOfflineLink } from '@/components/mobile-offline-link';
import { authFetch } from '@/lib/auth/client-session';
import type { PendingSessionReportsResponse } from '@/types/mobile-session-report';

export function MobilePendingReportsAlert() {
  const pendingReportsQuery = useQuery({
    queryKey: ['mobile-session-report-pending'],
    queryFn: async () => {
      const response = await authFetch('/api/mobile/session-report/pending');

      if (!response.ok) {
        throw new Error(`Pending reports request failed with status ${response.status}`);
      }

      return (await response.json()) as PendingSessionReportsResponse;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const data = pendingReportsQuery.data;
  const latest = data?.items[0];

  if (!data || data.total === 0 || !latest) {
    return null;
  }

  return (
    <section className="rounded-lg border border-orange-200 bg-orange-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-700">Rapports a completer</p>
          <p className="mt-2 text-sm font-semibold text-orange-950">
            {data.total} session{data.total > 1 ? 's' : ''} terminee{data.total > 1 ? 's' : ''} sans rapport.
          </p>
          <p className="mt-1 truncate text-xs text-orange-800">
            Derniere : {latest.siteName} - {formatDateTime(latest.endedAt)}
          </p>
        </div>
        <MobileOfflineLink
          className="shrink-0 rounded-lg bg-orange-600 px-3 py-2 text-xs font-bold text-white"
          href={`/rapport-session?sessionId=${encodeURIComponent(latest.departureRecordId)}`}
        >
          Rediger
        </MobileOfflineLink>
      </div>
    </section>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
