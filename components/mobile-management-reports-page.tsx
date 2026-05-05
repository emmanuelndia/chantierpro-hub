'use client';

import { useState, useEffect } from 'react';
import {
  MobileReportsLoadingState,
  MobileReportsErrorState,
  MobileReportsEmptyState
} from './mobile-reports-error-state';
import { authFetch } from '@/lib/auth/client-session';
import { MobileReportsList } from './mobile-reports-list';

export function MobileManagementReportsPage() {
  const [reports, setReports] = useState<any[]>([]);
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

        const data = await response.json();
        // Le format attendu est { data: [...] } d'après les autres routes standardisées
        setReports(data.data || data || []);
        setError(null);
      } catch (err: any) {
        console.error('Fetch reports error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchReports();
  }, []);

  if (loading) return <div className="p-4"><MobileReportsLoadingState count={4} /></div>;

  if (error) return (
    <div className="p-4">
      <MobileReportsErrorState
        message="Erreur de chargement"
        detail={error}
        onRetry={() => window.location.reload()}
      />
    </div>
  );

  if (reports.length === 0) return (
    <div className="p-4">
      <MobileReportsEmptyState
        message="Aucun rapport trouvé"
        description="Il n'y a pas encore de rapports soumis dans le système."
      />
    </div>
  );

  return (
    <div className="space-y-5 p-4 pb-20">
      <header>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Direction / Gestion</p>
        <h1 className="mt-1 text-2xl font-black text-slate-950">Rapports Terrain</h1>
      </header>

      <section>
        <MobileReportsList reports={reports} />
      </section>
    </div>
  );
}
