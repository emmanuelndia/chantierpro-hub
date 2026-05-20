'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth/client-session';
import {
  MobileReportsEmptyState,
  MobileReportsErrorState,
  MobileReportsLoadingState,
} from './mobile-reports-error-state';
import { MobileReportsList, type MobileReportsListItem } from './mobile-reports-list';

type ReportsListResponse = {
  data?: MobileReportsListItem[];
};

export function MobileManagementReportsPage() {
  const [reports, setReports] = useState<MobileReportsListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReports = async () => {
      try {
        setLoading(true);
        const response = await authFetch('/api/reports');

        if (!response.ok) {
          throw new Error(`Erreur ${response.status} lors du chargement des rapports`);
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
  }, []);

  if (loading) {
    return (
      <div className="p-4">
        <MobileReportsLoadingState count={4} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <MobileReportsErrorState
          detail={error}
          message="Connectez-vous pour charger les rapports"
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  if (reports.length === 0) {
    return (
      <div className="p-4">
        <MobileReportsEmptyState
          description="Il n'y a pas encore de rapports soumis dans le système."
          message="Aucun rapport trouvé"
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 pb-20">
      <header>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Direction / Gestion</p>
        <h1 className="mt-1 text-2xl font-black text-slate-950">Rapports terrain</h1>
      </header>

      <section>
        <MobileReportsList reports={reports} />
      </section>
    </div>
  );
}
