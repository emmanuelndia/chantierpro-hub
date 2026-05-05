'use client';

import { SignedImage } from './mobile/SignedImage';
import Link from 'next/link';
import { ReportValidationStatus } from '@prisma/client';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import type { MobileManagementReportDetailResponse } from '@/types/mobile-management-reports';

type MobileManagementReportDetailPageProps = Readonly<{
  reportId: string;
}>;

export function MobileManagementReportDetailPage({ reportId }: MobileManagementReportDetailPageProps) {
  const reportQuery = useQuery({
    queryKey: ['mobile-management-report-detail', reportId],
    queryFn: async () => {
      const response = await authFetch(`/api/mobile/management/reports/${reportId}`);
      if (!response.ok) {
        throw new Error(`Report detail request failed with status ${response.status}`);
      }
      return (await response.json()) as MobileManagementReportDetailResponse;
    },
    staleTime: 30_000,
  });

  const data = reportQuery.data;

  if (reportQuery.isLoading) {
    return (
      <div className="space-y-4 pb-20">
        <div className="h-40 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-64 animate-pulse rounded-lg bg-slate-100" />
      </div>
    );
  }

  if (reportQuery.isError || !data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
        Impossible de charger le détail du rapport.
      </div>
    );
  }

  const { report } = data;

  return (
    <div className="space-y-5 pb-20">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Rapport terrain</p>
            <h1 className="mt-1 text-xl font-black text-slate-950">{report.siteName}</h1>
            <p className="mt-1 text-sm font-semibold text-slate-600">{report.projectName}</p>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${statusTone(report.validationStatus)}`}>
            {statusLabel(report.validationStatus)}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Metric label="Auteur" value={report.authorName} />
          <Metric label="Soumis" value={formatDateTime(report.submittedAt)} />
          <Metric label="Pointage" value={clockInLabel(report.session.type)} />
          <Metric label="Distance" value={`${report.session.distanceToSite.toFixed(2)} km`} />
        </div>

        {report.validatedForClientAt ? (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
            Validé le {formatDateTime(report.validatedForClientAt)}
            {report.validatedForClientByName ? ` par ${report.validatedForClientByName}` : ''}
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Contenu</h2>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
          <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{report.content}</p>
        </div>
      </section>

      {report.session.comment ? (
        <section className="space-y-3">
          <h2 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Commentaire pointage</h2>
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700 shadow-panel">
            {report.session.comment}
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">Photos associées</h2>
          <span className="text-xs font-bold text-slate-400">{data.photos.length}</span>
        </div>
        {data.photos.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm font-semibold text-slate-500">
            Aucune photo associée disponible.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {data.photos.map((photo) => (
              <Link
                key={photo.id}
                href={`/api/photos/${encodeURIComponent(photo.id)}/content`}
                target="_blank"
                className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
              >
                <SignedImage
                  photoId={photo.id}
                  alt={photo.filename}
                  fill
                  sizes="50vw"
                  className="object-cover"
                />
                <span className="absolute inset-x-0 bottom-0 bg-slate-950/70 px-2 py-1 text-[10px] font-bold text-white">
                  {formatDateTime(photo.takenAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-2">
        <Link
          href={`/mobile/sites/${report.siteId}`}
          className="flex min-h-12 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-black text-slate-700"
        >
          Chantier
        </Link>
        <Link
          href={`/mobile/projects/${report.projectId}`}
          className="flex min-h-12 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-black text-slate-700"
        >
          Projet
        </Link>
      </div>
    </div>
  );
}

function Metric({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-black text-slate-950">{value}</p>
    </div>
  );
}

function statusLabel(status: ReportValidationStatus) {
  return status === ReportValidationStatus.VALIDATED_FOR_CLIENT ? 'Validé client' : 'Soumis';
}

function statusTone(status: ReportValidationStatus) {
  return status === ReportValidationStatus.VALIDATED_FOR_CLIENT
    ? 'bg-emerald-100 text-emerald-700'
    : 'bg-blue-100 text-blue-700';
}

function clockInLabel(type: string) {
  if (type === 'DEPARTURE') return 'Sortie';
  if (type === 'ARRIVAL') return 'Entrée';
  if (type === 'PAUSE_START') return 'Pause';
  if (type === 'PAUSE_END') return 'Reprise';
  return type;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
