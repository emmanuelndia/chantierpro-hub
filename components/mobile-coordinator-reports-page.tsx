'use client';

import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  MobileReportsLoadingState,
  MobileReportsErrorState,
  MobileReportsEmptyState
} from './mobile-reports-error-state';
import { authFetch } from '@/lib/auth/client-session';
import { MobileReportsList } from './mobile-reports-list';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type {
  ReportFilter,
  PendingReport,
  ReceivedReport,
  ReportDetail,
  CoordinatorReportsResponse,
  ReportStatus,
} from '@/types/mobile-reports';

type MobileCoordinatorReportsPageProps = Readonly<{
  user: WebSessionUser;
}>;

export function MobileCoordinatorReportsPage({ user }: MobileCoordinatorReportsPageProps) {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    // Dans cet exemple, on récupère tous les rapports du site sélectionné ou de l'utilisateur
    // Pour un coordinateur, on utilise généralement /api/sites/:id/reports ou une route plus large
    // Ici on suit la logique demandée par l'USER
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
        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Coordinateur</p>
        <h1 className="mt-1 text-2xl font-black text-slate-950">Rapports reçus</h1>
      </div>
      <MobileReportsList reports={reports} />
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  children,
}: Readonly<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}>) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 snap-center items-center gap-1 rounded-lg px-4 py-2 text-sm font-semibold transition active:scale-[0.98] ${active
          ? 'bg-primary text-white'
          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
        }`}
    >
      {children}
    </button>
  );
}

function PendingReportCard({
  report,
  onRemind,
  isReminding,
}: Readonly<{
  report: PendingReport;
  onRemind: () => void;
  isReminding: boolean;
}>) {
  return (
    <div className={`rounded-lg border p-3 ${report.isOverdue
        ? 'border-red-200 bg-red-50'
        : 'border-orange-200 bg-orange-50'
      }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold text-slate-950">
            {report.supervisorFirstName} {report.supervisorName}
          </h3>
          <p className="mt-1 truncate text-xs font-semibold text-slate-600">{report.siteName}</p>
          <p className="mt-1 text-xs text-slate-500">
            Session terminée: {formatEventTime(report.sessionEndedAt)}
          </p>
          {report.isOverdue && (
            <p className="mt-1 text-xs font-semibold text-red-600">
              En retard
            </p>
          )}
        </div>
        <button
          onClick={onRemind}
          disabled={isReminding}
          className="shrink-0 rounded-lg bg-orange-600 px-3 py-1.5 text-xs font-bold text-white transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isReminding ? 'Envoi...' : 'Relancer'}
        </button>
      </div>
    </div>
  );
}

function ReceivedReportCard({ report }: Readonly<{ report: ReceivedReport }>) {
  const statusColors = {
    SUBMITTED: 'bg-blue-100 text-blue-700',
    REVIEWED: 'bg-orange-100 text-orange-700',
    VALIDATED: 'bg-emerald-100 text-emerald-700',
    SENT: 'bg-purple-100 text-purple-700',
  };

  return (
    <Link
      className="block rounded-lg border border-emerald-200 bg-emerald-50 p-3 shadow-panel transition active:scale-[0.99]"
      href={`/mobile/reports/${report.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">
              {report.supervisorName}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${statusColors[report.status]}`}>
              {getStatusLabel(report.status)}
            </span>
          </div>
          <h3 className="mt-2 truncate text-sm font-bold text-slate-950">{report.siteName}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{report.content}</p>
          <p className="mt-2 text-xs text-slate-500">
            Soumis: {formatEventTime(report.submittedAt)}
          </p>
        </div>
      </div>
    </Link>
  );
}

function ReportsLoadingState() {
  return (
    <div className="space-y-5">
      <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
      <div className="space-y-3">
        <div className="h-5 w-32 animate-pulse rounded bg-slate-100" />
        <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
      </div>
    </div>
  );
}

function formatEventTime(value: string | null) {
  if (!value) {
    return 'Nouveau';
  }

  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function DownloadIcon({ className }: Readonly<{ className: string }>) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
      />
    </svg>
  );
}

function getStatusLabel(status: ReportStatus) {
  const labels = {
    SUBMITTED: 'Soumis',
    REVIEWED: 'Révisé',
    VALIDATED: 'Validé',
    SENT: 'Envoyé',
    PENDING: 'En attente',
  };
  return labels[status] || status;
}

function ReportsIcon({ className }: Readonly<{ className: string }>) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="M7 4h7l4 4v12H7V4Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M14 4v4h4M10 12h5M10 16h5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}
