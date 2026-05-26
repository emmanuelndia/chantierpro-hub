'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { PhotoTag } from '@prisma/client';
import { Badge } from '@/components/badge';
import { DocumentAttachmentsPanel } from '@/components/document-attachments-panel';
import { EmptyState } from '@/components/empty-state';
import { authFetch } from '@/lib/auth/client-session';
import type { ReportDetail } from '@/types/reports';

type ReportDetailPageProps = Readonly<{
  reportId: string;
}>;

export function ReportDetailPage({ reportId }: ReportDetailPageProps) {
  const query = useQuery({
    queryKey: ['report', reportId],
    queryFn: () => fetchReport(reportId),
  });

  if (query.isLoading) {
    return <div className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />;
  }

  if (query.isError || !query.data) {
    return (
      <EmptyState
        ctaHref="/dashboard"
        ctaLabel="Retour dashboard"
        title="Rapport introuvable"
        description="Le rapport demande est indisponible ou hors de votre perimetre."
      />
    );
  }

  const report = query.data.report;
  const photoGroups = groupReportPhotos(report.photos);

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <Link className="text-sm font-semibold text-orange-600 transition hover:text-orange-700" href="/web/reports">
          Retour aux rapports
        </Link>
        <div className="mt-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Rapport terrain</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              {report.author.firstName} {report.author.lastName}
            </h1>
            <p className="mt-3 text-sm text-slate-500">
              {report.projectName} - {report.siteName} - soumis le {formatDateTime(report.submittedAt)}
            </p>
          </div>
          <Badge tone={report.validationStatus === 'VALIDATED_FOR_CLIENT' ? 'success' : 'warning'}>
            {report.hasText && report.hasAttachments
              ? 'Texte + fichier'
              : report.hasAttachments
                ? 'Fichier'
                : report.validationStatus === 'VALIDATED_FOR_CLIENT'
                  ? 'Valide client'
                  : 'Texte'}
          </Badge>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <aside className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
          <h2 className="text-xl font-semibold text-slate-950">Informations</h2>
          <dl className="mt-5 space-y-4 text-sm">
            <InfoRow label="Rapport ID" value={report.id} />
            <InfoRow label="Projet" value={report.projectName} />
            <InfoRow label="Chantier" value={report.siteName} />
            <InfoRow label="Session" value={`${report.session.type} - ${report.session.date} ${report.session.time}`} />
            <InfoRow label="Distance site" value={`${report.session.distanceToSite.toFixed(2)} km`} />
            <InfoRow label="Progression" value={report.progression === null ? 'n/a' : `${report.progression}%`} />
            <InfoRow label="Statut" value={report.status} />
            <InfoRow label="Blocage" value={report.blocage ?? 'Aucun'} />
            <InfoRow label="Auteur" value={`${report.author.firstName} ${report.author.lastName} (${report.author.role})`} />
            <InfoRow
              label="Validation"
              value={
                report.validatedForClientAt
                  ? `${formatDateTime(report.validatedForClientAt)} par ${report.validatedForClientBy?.firstName ?? ''} ${report.validatedForClientBy?.lastName ?? ''}`.trim()
                  : 'Non valide'
              }
            />
          </dl>
        </aside>

        <article className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
          <h2 className="text-xl font-semibold text-slate-950">Contenu du rapport</h2>
          {report.hasText ? (
            <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-slate-700">{report.content}</p>
          ) : (
            <p className="mt-5 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Aucun texte saisi. Ce rapport contient uniquement des pièces jointes.
            </p>
          )}
          {report.session.comment ? (
            <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Commentaire session</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">{report.session.comment}</p>
            </div>
          ) : null}
        </article>
      </section>

      <DocumentAttachmentsPanel
        context={{ reportId }}
        description="Fichiers transmis avec ce rapport terrain."
        title="Pièces jointes du rapport"
      />

      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <h2 className="text-xl font-semibold text-slate-950">Photos liees</h2>
        {report.photos.length === 0 ? (
          <p className="mt-5 rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            Aucune photo rattachee a ce rapport.
          </p>
        ) : (
          <div className="mt-5 space-y-5">
            {photoGroups.map((group) => (
              <div key={group.label} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-bold text-slate-900">{group.label}</h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {group.photos.map((photo) => (
                    <article key={photo.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt={photo.filename} className="h-40 w-full object-cover" src={photo.url} />
                      <div className="space-y-2 p-4">
                        <p className="truncate text-sm font-semibold text-slate-900">{photo.filename}</p>
                        <p className="text-xs text-slate-500">{formatDateTime(photo.takenAt)}</p>
                        <PhotoTagBadges tags={photo.tags} />
                        {photo.description ? (
                          <p className="text-xs leading-5 text-slate-600">{photo.description}</p>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

async function fetchReport(reportId: string) {
  const response = await authFetch(`/api/reports/${reportId}`, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Report request failed with status ${response.status}`);
  }

  return (await response.json()) as { report: ReportDetail };
}

function InfoRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</dt>
      <dd className="mt-1 break-words font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function groupReportPhotos(photos: ReportDetail['photos']) {
  const groups = new Map<string, ReportDetail['photos']>();

  for (const photo of photos) {
    const label = photo.assignmentAction ? `Tache - ${photo.assignmentAction}` : 'Photos chantier';
    groups.set(label, [...(groups.get(label) ?? []), photo]);
  }

  return [...groups.entries()].map(([label, groupedPhotos]) => ({
    label,
    photos: groupedPhotos,
  }));
}

function PhotoTagBadges({ tags }: Readonly<{ tags: PhotoTag[] }>) {
  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span key={tag} className="rounded-full bg-orange-50 px-2 py-1 text-[11px] font-bold text-orange-700">
          {formatPhotoTag(tag)}
        </span>
      ))}
    </div>
  );
}

function formatPhotoTag(tag: PhotoTag) {
  const labels: Record<PhotoTag, string> = {
    TASK_START: 'Debut tache',
    TASK_END: 'Fin tache',
    BLOCKAGE: 'Blocage',
    WORK_PROOF: 'Preuve travaux',
    INCIDENT: 'Incident',
  };

  return labels[tag];
}
