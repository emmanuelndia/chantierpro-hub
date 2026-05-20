'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth/client-session';
import type { WebSessionUser } from '@/lib/auth/web-session';
import {
  MobileReportsEmptyState,
  MobileReportsErrorState,
  MobileReportsLoadingState,
} from './mobile-reports-error-state';
import { MobileReportsList, type MobileReportsListItem } from './mobile-reports-list';

type MobileCoordinatorReportsPageProps = Readonly<{
  user: WebSessionUser;
}>;

type ReportsListResponse = {
  data?: MobileReportsListItem[];
};

export function MobileCoordinatorReportsPage({ user }: MobileCoordinatorReportsPageProps) {
  const [reports, setReports] = useState<MobileReportsListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReports = async () => {
      try {
        setLoading(true);
        const response = await authFetch('/api/reports');

        if (!response.ok) {
          throw new Error(`Erreur ${response.status}`);
        }

        const data = (await response.json()) as ReportsListResponse | MobileReportsListItem[];
        setReports(Array.isArray(data) ? data : data.data ?? []);
        setError(null);
      } catch {
        setError('Connectez-vous pour charger les rapports.');
      } finally {
        setLoading(false);
      }
    };

    void fetchReports();
  }, [user.role]);

  if (loading) return <MobileReportsLoadingState />;

  if (error) {
    return (
      <MobileReportsErrorState
        detail={error}
        message="Connectez-vous pour charger les rapports"
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (reports.length === 0) {
    return <MobileReportsEmptyState message="Aucun rapport pour le moment" />;
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Coordinateur</p>
        <h1 className="mt-1 text-2xl font-black text-slate-950">Rapports reçus</h1>
      </div>
      <MobileReportsList reports={reports} />
    </div>
  );
}
