'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SignedImage } from './mobile/SignedImage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import type { ReportDetail, ReportPhoto, ReportStatus } from '@/types/mobile-reports';

type MobileReportDetailPageProps = Readonly<{
  reportId: string;
}>;

export function MobileReportDetailPage({ reportId }: MobileReportDetailPageProps) {
  const [coordinatorComment, setCoordinatorComment] = useState('');
  const queryClient = useQueryClient();

  const reportQuery = useQuery({
    queryKey: ['mobile-report-detail', reportId],
    queryFn: async () => {
      const response = await authFetch(`/api/mobile/coordinator/reports/${reportId}`);

      if (!response.ok) {
        throw new Error(`Report detail request failed with status ${response.status}`);
      }

      return (await response.json()) as ReportDetail;
    },
    staleTime: 30_000,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ status, comment }: { status: ReportStatus; comment?: string }) => {
      const response = await authFetch(`/api/mobile/coordinator/reports/${reportId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status,
          coordinatorComment: comment,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update report status');
      }

      return (await response.json()) as { status: ReportStatus; updatedAt: string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mobile-report-detail', reportId] });
      void queryClient.invalidateQueries({ queryKey: ['mobile-coordinator-reports'] });
    },
  });

  const report = reportQuery.data;

  const handleValidate = () => {
    updateStatusMutation.mutate({
      status: 'VALIDATED',
      comment: coordinatorComment,
    });
  };

  const handleMarkAsSent = () => {
    updateStatusMutation.mutate({
      status: 'SENT',
      comment: coordinatorComment,
    });
  };

  const downloadReport = async (id: string, format: 'pdf' | 'txt' = 'pdf') => {
    try {
      const response = await authFetch(`/api/reports/${id}/download?format=${format}`);
      
      if (!response.ok) {
        throw new Error('Échec du téléchargement du rapport');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `rapport_${id}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Erreur lors du téléchargement:', error);
      alert('Impossible de télécharger le rapport. Veuillez réessayer.');
    }
  };

  if (reportQuery.isLoading) {
    return <ReportDetailLoadingState />;
  }

  if (reportQuery.isError || !report) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
        Impossible de charger le rapport. Veuillez réessayer.
      </div>
    );
  }

  const canValidate = report.status === 'SUBMITTED' || report.status === 'REVIEWED';
  const canMarkAsSent = report.status === 'VALIDATED';

  return (
    <div className="space-y-5 pb-20">
      {/* En-tête du rapport */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-slate-950">
              {report.supervisorFirstName} {report.supervisorName}
            </h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">{report.siteName}</p>
            <p className="mt-1 text-xs text-slate-500">{report.siteAddress}</p>
          </div>
          <StatusBadge status={report.status} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <MetricTile
            label="Durée session"
            value={formatDuration(report.sessionDuration)}
          />
          <MetricTile
            label="Progression"
            value={`${report.progressPercentage}%`}
          />
        </div>

        <div className="mt-4 text-xs text-slate-500">
          <p>Début: {formatDateTime(report.sessionStartedAt)}</p>
          <p>Fin: {formatDateTime(report.sessionEndedAt)}</p>
          <p>Soumis: {formatDateTime(report.submittedAt)}</p>
        </div>
      </section>

      {/* Contenu du rapport */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          Contenu du rapport
        </h3>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
          <div className="max-h-96 overflow-y-auto custom-scrollbar">
            <p className="text-sm leading-6 text-slate-700 whitespace-pre-wrap">
              {report.content}
            </p>
          </div>
        </div>
      </section>

      {/* Photos */}
      {report.photos.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
              Photos
            </h3>
            <span className="text-xs font-semibold text-slate-400">
              {report.photos.length} photos
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {report.photos.map((photo) => (
              <PhotoCard key={photo.id} photo={photo} />
            ))}
          </div>
        </section>
      )}

      {/* Commentaire coordinateur */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          Commentaire coordinateur
        </h3>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
          <textarea
            value={coordinatorComment}
            onChange={(e) => setCoordinatorComment(e.target.value)}
            placeholder="Ajouter un commentaire ou une annotation..."
            className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-5 text-slate-700 placeholder-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            rows={4}
          />
          {report.coordinatorComment && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-500 mb-1">Commentaire précédent:</p>
              <p className="text-sm text-slate-700">{report.coordinatorComment}</p>
            </div>
          )}
        </div>
      </section>

      {/* Actions */}
      <section className="space-y-3">
        {/* Boutons de téléchargement */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => {
              void downloadReport(report.id, 'pdf');
            }}
            className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-center text-sm font-black text-slate-700 shadow-lg transition active:scale-[0.98]"
          >
            <DownloadIcon className="h-4 w-4" />
            PDF
          </button>
          <button
            onClick={() => {
              void downloadReport(report.id, 'txt');
            }}
            className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-center text-sm font-black text-slate-700 shadow-lg transition active:scale-[0.98]"
          >
            <DownloadIcon className="h-4 w-4" />
            Texte
          </button>
        </div>

        {canValidate && (
          <button
            onClick={handleValidate}
            disabled={updateStatusMutation.isPending}
            className="flex min-h-14 w-full items-center justify-center rounded-lg bg-emerald-600 px-5 text-center text-base font-black text-white shadow-lg transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updateStatusMutation.isPending ? 'Validation...' : 'Valider pour client'}
          </button>
        )}

        {canMarkAsSent && (
          <button
            onClick={handleMarkAsSent}
            disabled={updateStatusMutation.isPending}
            className="flex min-h-14 w-full items-center justify-center rounded-lg bg-purple-600 px-5 text-center text-base font-black text-white shadow-lg transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {updateStatusMutation.isPending ? 'Envoi...' : 'Marquer comme envoyé'}
          </button>
        )}

        <Link
          href="/mobile/reports"
          className="flex min-h-14 w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-center text-base font-black text-slate-700 shadow-lg transition active:scale-[0.98]"
        >
          Retour aux rapports
        </Link>
      </section>
    </div>
  );
}

function StatusBadge({ status }: Readonly<{ status: ReportStatus }>) {
  const statusConfig = {
    SUBMITTED: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Soumis' },
    REVIEWED: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Révisé' },
    VALIDATED: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Validé' },
    SENT: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Envoyé' },
    PENDING: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'En attente' },
  };

  const config = statusConfig[status] || statusConfig.PENDING;

  return (
    <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${config.bg} ${config.text}`}>
      {config.label}
    </span>
  );
}

function MetricTile({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-center">
      <div className="text-lg font-black text-slate-950">{value}</div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
    </div>
  );
}

function PhotoCard({ photo }: Readonly<{ photo: ReportPhoto }>) {
  return (
    <Link
      href={`/api/photos/${encodeURIComponent(photo.id)}/content`}
      target="_blank"
      className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
    >
      <SignedImage
        photoId={photo.id}
        alt={photo.filename}
        className="object-cover"
        fill
        sizes="(max-width: 768px) 50vw, 25vw"
      />
      <div className="absolute inset-x-0 bottom-0 bg-slate-950/70 px-1.5 py-1 text-[10px] font-semibold text-white">
        <span className="block truncate">
          {formatTime(photo.takenAt)}
        </span>
      </div>
    </Link>
  );
}

function ReportDetailLoadingState() {
  return (
    <div className="space-y-5">
      <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
      <div className="space-y-3">
        <div className="h-5 w-32 animate-pulse rounded bg-slate-100" />
        <div className="h-48 animate-pulse rounded-lg bg-slate-100" />
      </div>
      <div className="space-y-3">
        <div className="h-5 w-24 animate-pulse rounded bg-slate-100" />
        <div className="grid grid-cols-2 gap-2">
          <div className="aspect-square animate-pulse rounded-lg bg-slate-100" />
          <div className="aspect-square animate-pulse rounded-lg bg-slate-100" />
        </div>
      </div>
    </div>
  );
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}min`;
  }

  return `${minutes}min`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
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
