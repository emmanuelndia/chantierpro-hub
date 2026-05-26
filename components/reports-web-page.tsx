'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ReportStatus, ReportValidationStatus, type Role } from '@prisma/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, Download, FileText, FolderOpen } from 'lucide-react';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { TableActionsMenu } from '@/components/table-actions-menu';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import type {
  WebReportItem,
  WebReportsResponse,
  WebReportStatusFilter,
  WebReportValidationFilter,
} from '@/types/reports';

type ReportsWebPageProps = Readonly<{
  viewer: {
    role: Role;
  };
}>;

const statusOptions: { value: WebReportStatusFilter; label: string }[] = [
  { value: 'ALL', label: 'Tous' },
  { value: ReportStatus.RECU, label: 'Recu' },
  { value: ReportStatus.EN_REVUE, label: 'En revue' },
  { value: ReportStatus.VALIDE, label: 'Valide' },
  { value: ReportStatus.ENVOYE, label: 'Envoye' },
];

const validationOptions: { value: WebReportValidationFilter; label: string }[] = [
  { value: 'ALL', label: 'Toutes' },
  { value: ReportValidationStatus.SUBMITTED, label: 'Soumis' },
  { value: ReportValidationStatus.VALIDATED_FOR_CLIENT, label: 'Valide client' },
];

const filterInputClassName =
  'w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-500';

export function ReportsWebPage({ viewer }: ReportsWebPageProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [projectId, setProjectId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [status, setStatus] = useState<WebReportStatusFilter>('ALL');
  const [validationStatus, setValidationStatus] = useState<WebReportValidationFilter>('ALL');
  const [q, setQ] = useState('');

  const filters = useMemo(
    () => ({
      page,
      from,
      to,
      projectId,
      siteId,
      resourceId,
      status,
      validationStatus,
      q,
    }),
    [from, page, projectId, q, resourceId, siteId, status, to, validationStatus],
  );

  const query = useQuery({
    queryKey: ['web-reports', filters],
    queryFn: () => fetchReports(filters),
  });

  const validateMutation = useMutation({
    mutationFn: validateReport,
    onSuccess: async () => {
      pushToast({
        type: 'success',
        title: 'Rapport valide',
        message: 'Le rapport est pret pour envoi client.',
      });
      await queryClient.invalidateQueries({ queryKey: ['web-reports'] });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Validation impossible',
        message: error instanceof Error ? error.message : 'Le rapport ne peut pas etre valide.',
      });
    },
  });

  const data = query.data;

  function resetPageAnd(run: () => void) {
    setPage(1);
    run();
  }

  function buildExportUrl(format: 'csv' | 'xlsx' | 'pdf' | 'txt') {
    const searchParams = buildSearchParams(filters);
    searchParams.set('format', format);
    searchParams.delete('page');
    return `/api/reports/web/export?${searchParams.toString()}`;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">Rapports terrain</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Consultation web des rapports</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Filtre, controle, telecharge et exporte les rapports soumis depuis le terrain.
            </p>
          </div>
          <Badge tone={query.isFetching ? 'warning' : 'info'}>
            {query.isFetching ? 'Actualisation...' : data ? `Maj ${formatTime(data.generatedAt)}` : 'Chargement'}
          </Badge>
        </div>
      </section>

      {query.isError ? (
        <EmptyState
          title="Rapports indisponibles"
          description="Les rapports terrain n'ont pas pu etre charges. Verifie ta session puis reessaie."
        />
      ) : null}

      {data ? (
        <>
          <section className="grid gap-4 md:grid-cols-4">
            <MetricCard label="Total rapports" value={data.widgets.total} tone="neutral" />
            <MetricCard label="Soumis" value={data.widgets.submitted} tone="warning" />
            <MetricCard label="Valides client" value={data.widgets.validated} tone="success" />
            <MetricCard label="Chantiers" value={data.widgets.sites} tone="info" />
          </section>

          <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
            <div className="mb-5 flex flex-col gap-1">
              <h2 className="text-lg font-semibold text-slate-950">Filtres rapports</h2>
              <p className="text-sm text-slate-500">Affinez les rapports visibles avant consultation ou export.</p>
            </div>
            <div className="grid gap-4 lg:grid-cols-4">
              <Field label="Du">
                <input
                  className={filterInputClassName}
                  onChange={(event) => resetPageAnd(() => setFrom(event.target.value))}
                  type="date"
                  value={from}
                />
              </Field>
              <Field label="Au">
                <input
                  className={filterInputClassName}
                  onChange={(event) => resetPageAnd(() => setTo(event.target.value))}
                  type="date"
                  value={to}
                />
              </Field>
              <Field label="Projet">
                <select
                  className={filterInputClassName}
                  onChange={(event) => resetPageAnd(() => {
                    setProjectId(event.target.value);
                    setSiteId('');
                  })}
                  value={projectId}
                >
                  <option value="">Tous</option>
                  {data.options.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Chantier">
                <select
                  className={filterInputClassName}
                  onChange={(event) => resetPageAnd(() => setSiteId(event.target.value))}
                  value={siteId}
                >
                  <option value="">Tous</option>
                  {data.options.sites
                    .filter((site) => !projectId || site.projectId === projectId)
                    .map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Ressource">
                <select
                  className={filterInputClassName}
                  onChange={(event) => resetPageAnd(() => setResourceId(event.target.value))}
                  value={resourceId}
                >
                  <option value="">Toutes</option>
                  {data.options.resources.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Statut rapport">
                <select
                  className={filterInputClassName}
                  onChange={(event) => resetPageAnd(() => setStatus(event.target.value as WebReportStatusFilter))}
                  value={status}
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Validation client">
                <select
                  className={filterInputClassName}
                  onChange={(event) => resetPageAnd(() => setValidationStatus(event.target.value as WebReportValidationFilter))}
                  value={validationStatus}
                >
                  {validationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Recherche">
                <input
                  className={filterInputClassName}
                  onChange={(event) => resetPageAnd(() => setQ(event.target.value))}
                  placeholder="Projet, site, ressource..."
                  type="search"
                  value={q}
                />
              </Field>
            </div>
            <div className="mt-5 flex justify-end border-t border-slate-100 pt-4">
              <details className="group relative">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800">
                  <Download className="h-4 w-4" />
                  Exporter
                  <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
                </summary>
                <div className="absolute right-0 top-12 z-20 min-w-44 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl">
                  {(['csv', 'xlsx', 'pdf', 'txt'] as const).map((format) => (
                    <a
                      className="block rounded-xl px-3 py-2.5 text-sm font-medium uppercase text-slate-700 transition hover:bg-slate-50"
                      href={buildExportUrl(format)}
                      key={format}
                    >
                      Export {format}
                    </a>
                  ))}
                </div>
              </details>
            </div>
          </section>

          <ReportsTable
            canValidate={viewer.role === 'COORDINATOR'}
            items={data.items}
            onValidate={(reportId) => validateMutation.mutate(reportId)}
            validatingId={validateMutation.variables ?? null}
            validating={validateMutation.isPending}
          />

          <div className="flex items-center justify-between rounded-[2rem] border border-slate-200 bg-white p-4 text-sm shadow-panel">
            <button
              className="rounded-2xl border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              disabled={data.page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              type="button"
            >
              Precedent
            </button>
            <span className="font-semibold text-slate-600">
              Page {data.page} / {data.totalPages}
            </span>
            <button
              className="rounded-2xl border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              disabled={data.page >= data.totalPages}
              onClick={() => setPage((current) => Math.min(data.totalPages, current + 1))}
              type="button"
            >
              Suivant
            </button>
          </div>
        </>
      ) : (
        <LoadingState />
      )}
    </div>
  );
}

async function fetchReports(filters: ReportFilters) {
  const response = await authFetch(`/api/reports/web?${buildSearchParams(filters).toString()}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Reports request failed with status ${response.status}`);
  }

  return (await response.json()) as WebReportsResponse;
}

async function validateReport(reportId: string) {
  const response = await authFetch(`/api/reports/${reportId}/validate-client`, {
    method: 'POST',
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Validation refusee.');
  }
}

type ReportFilters = {
  page: number;
  from: string;
  to: string;
  projectId: string;
  siteId: string;
  resourceId: string;
  status: WebReportStatusFilter;
  validationStatus: WebReportValidationFilter;
  q: string;
};

function buildSearchParams(filters: ReportFilters) {
  const searchParams = new URLSearchParams({
    page: String(filters.page),
    status: filters.status,
    validationStatus: filters.validationStatus,
  });

  if (filters.from) searchParams.set('from', filters.from);
  if (filters.to) searchParams.set('to', filters.to);
  if (filters.projectId) searchParams.set('projectId', filters.projectId);
  if (filters.siteId) searchParams.set('siteId', filters.siteId);
  if (filters.resourceId) searchParams.set('resourceId', filters.resourceId);
  if (filters.q) searchParams.set('q', filters.q);

  return searchParams;
}

function ReportsTable({
  items,
  canValidate,
  validating,
  validatingId,
  onValidate,
}: Readonly<{
  items: WebReportItem[];
  canValidate: boolean;
  validating: boolean;
  validatingId: string | null;
  onValidate: (reportId: string) => void;
}>) {
  if (items.length === 0) {
    return (
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <EmptyState
          title="Aucun rapport"
          description="Aucun rapport ne correspond aux filtres selectionnes."
        />
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-panel">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="px-4 py-4">Date</th>
              <th className="px-4 py-4">Ressource</th>
              <th className="px-4 py-4">Projet</th>
              <th className="px-4 py-4">Chantier</th>
              <th className="px-4 py-4">Progression</th>
              <th className="px-4 py-4">Statut</th>
              <th className="px-4 py-4">Validation</th>
              <th className="px-4 py-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr className="align-top" key={item.id}>
                <td className="whitespace-nowrap px-4 py-4 text-slate-600">{formatDateTime(item.submittedAt)}</td>
                <td className="px-4 py-4">
                  <p className="font-semibold text-slate-950">{item.authorName}</p>
                  <p className="text-xs text-slate-500">{item.authorRole}</p>
                </td>
                <td className="px-4 py-4 text-slate-700">{item.projectName}</td>
                <td className="px-4 py-4 text-slate-700">{item.siteName}</td>
                <td className="px-4 py-4">
                  <div className="space-y-2">
                    <ProgressValue value={item.progression} />
                    {item.hasAttachments ? <Badge tone="info">{item.attachmentsCount} fichier(s)</Badge> : null}
                    {!item.hasText && item.hasAttachments ? <Badge tone="warning">Sans texte</Badge> : null}
                  </div>
                </td>
                <td className="px-4 py-4">
                  <Badge tone="neutral">{reportStatusLabel(item.status)}</Badge>
                </td>
                <td className="px-4 py-4">
                  <Badge tone={item.validationStatus === 'VALIDATED_FOR_CLIENT' ? 'success' : 'warning'}>
                    {validationLabel(item.validationStatus)}
                  </Badge>
                </td>
                <td className="px-4 py-4">
                  <TableActionsMenu
                    actions={[
                      {
                        label: 'Ouvrir',
                        icon: <FolderOpen className="h-4 w-4" />,
                        href: `/reports/${item.id}`,
                        navigation: 'client',
                      },
                      {
                        label: 'Telecharger PDF',
                        icon: <Download className="h-4 w-4" />,
                        href: `/api/reports/${item.id}/download?format=pdf`,
                      },
                      {
                        label: 'Telecharger TXT',
                        icon: <FileText className="h-4 w-4" />,
                        href: `/api/reports/${item.id}/download?format=txt`,
                      },
                      ...(canValidate && item.validationStatus !== 'VALIDATED_FOR_CLIENT'
                        ? [
                            {
                              label: validating && validatingId === item.id ? 'Validation...' : 'Valider',
                              icon: <CheckCircle2 className="h-4 w-4" />,
                              tone: 'success' as const,
                              disabled: validating && validatingId === item.id,
                              onClick: () => onValidate(item.id),
                            },
                          ]
                        : []),
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Field({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <label className="text-sm font-semibold text-slate-700">
      {label}
      <div className="mt-2">{children}</div>
    </label>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: Readonly<{ label: string; value: number; tone: 'success' | 'warning' | 'neutral' | 'info' }>) {
  const className = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warning: 'border-orange-200 bg-orange-50 text-orange-900',
    neutral: 'border-slate-200 bg-white text-slate-900',
    info: 'border-blue-200 bg-blue-50 text-blue-900',
  }[tone];

  return (
    <article className={`rounded-[2rem] border p-5 shadow-panel ${className}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70">{label}</p>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
    </article>
  );
}

function ProgressValue({ value }: Readonly<{ value: number | null }>) {
  if (value === null) {
    return <span className="text-slate-400">n/a</span>;
  }

  return (
    <div className="w-32">
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      <p className="mt-1 text-xs font-semibold text-slate-600">{value}%</p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
        ))}
      </section>
      <div className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
    </div>
  );
}

function reportStatusLabel(status: ReportStatus) {
  switch (status) {
    case ReportStatus.RECU:
      return 'Recu';
    case ReportStatus.EN_REVUE:
      return 'En revue';
    case ReportStatus.VALIDE:
      return 'Valide';
    case ReportStatus.ENVOYE:
      return 'Envoye';
    default:
      return status;
  }
}

function validationLabel(status: ReportValidationStatus) {
  return status === ReportValidationStatus.VALIDATED_FOR_CLIENT ? 'Valide client' : 'Soumis';
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
