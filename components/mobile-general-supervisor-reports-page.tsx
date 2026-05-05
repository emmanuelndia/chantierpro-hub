'use client';

import { useState, useEffect } from 'react';
import {
  MobileReportsLoadingState,
  MobileReportsErrorState,
  MobileReportsEmptyState
} from './mobile-reports-error-state';
import { authFetch } from '@/lib/auth/client-session';
import { MobileReportsList } from './mobile-reports-list';
import type { WebSessionUser } from '@/lib/auth/web-session';

type MobileGeneralSupervisorReportsPageProps = Readonly<{
  user: WebSessionUser;
}>;

export function MobileGeneralSupervisorReportsPage({ user }: MobileGeneralSupervisorReportsPageProps) {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReports = async () => {
      try {
        const url = user.role === 'SUPERVISOR'
          ? '/api/users/me/reports'
          : `/api/reports`;

        const response = await authFetch(url);

        if (!response.ok) {
          throw new Error(`Erreur ${response.status}`);
        }

        const data = await response.json();
        setReports(data.data || []);
        setLoading(false);
      } catch (err: any) {
        setError(err.message);
        setLoading(false);
      }
    };

    fetchReports();
  }, [user.role]);

  if (loading) return <MobileReportsLoadingState />;

  if (error) return (
    <MobileReportsErrorState
      message="Impossible de charger les rapports"
      detail={error}
      onRetry={() => window.location.reload()}
    />
  );

  if (reports.length === 0) return (
    <MobileReportsEmptyState message="Aucun rapport pour le moment" />
  );

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Général Superviseur</p>
        <h1 className="mt-1 text-2xl font-black text-slate-950">Rapports terrain</h1>
      </div>
      <MobileReportsList reports={reports} />
    </div>
  );
}
