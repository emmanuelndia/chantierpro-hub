'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/badge';
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

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <Link className="text-sm font-semibold text-orange-600 transition hover:text-orange-700" href="/dashboard">
          Retour au dashboard
        </Link>
        <div className="mt-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Rapport terrain</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              {report.author.firstName} {report.author.lastName}
            </h1>
            <p className="mt-3 text-sm text-slate-500">Soumis le {formatDateTime(report.submittedAt)}</p>
          </div>
          <Badge tone={report.validationStatus === 'VALIDATED_FOR_CLIENT' ? 'success' : 'warning'}>
            {report.validationStatus === 'VALIDATED_FOR_CLIENT' ? 'Valide client' : 'En attente validation'}
          </Badge>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <aside className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
          <h2 className="text-xl font-semibold text-slate-950">Informations</h2>
          <dl className="mt-5 space-y-4 text-sm">
            <InfoRow label="Rapport ID" value={report.id} />
            <InfoRow label="Chantier" value={report.siteId} />
            <InfoRow label="Session" value={`${report.session.type} - ${report.session.date} ${report.session.time}`} />
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
          <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-slate-700">{report.content}</p>
        </article>
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
