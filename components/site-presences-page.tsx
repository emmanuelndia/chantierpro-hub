'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClockInType, type Role } from '@prisma/client';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import type { SiteDetail, PaginatedSitePresencesResponse } from '@/types/projects';
import type { TeamDetail } from '@/types/teams';

type SitePresencesPageProps = Readonly<{
  siteId: string;
  viewer: {
    role: Role;
  };
}>;

export function SitePresencesPage({ siteId, viewer }: SitePresencesPageProps) {
  const { pushToast } = useToast();
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState<'ALL' | ClockInType>('ALL');
  const [resourceIds, setResourceIds] = useState<string[]>([]);

  const siteQuery = useQuery({
    queryKey: ['site-detail', siteId],
    queryFn: async () => {
      const response = await authFetch(`/api/sites/${siteId}`);
      if (!response.ok) {
        throw new Error(`Site detail request failed with status ${response.status}`);
      }

      return ((await response.json()) as { site: SiteDetail }).site;
    },
  });

  const teamsQuery = useQuery({
    queryKey: ['site-teams', siteId],
    queryFn: async () => {
      const response = await authFetch(`/api/sites/${siteId}/teams`);
      if (!response.ok) {
        throw new Error(`Site teams request failed with status ${response.status}`);
      }

      return ((await response.json()) as { items: TeamDetail[] }).items;
    },
  });

  const presencesQuery = useQuery({
    queryKey: ['site-presences', siteId, page, from, to, type, resourceIds],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      searchParams.set('page', String(page));
      if (from) {
        searchParams.set('from', from);
      }
      if (to) {
        searchParams.set('to', to);
      }
      if (type !== 'ALL') {
        searchParams.set('type', type);
      }
      if (resourceIds.length > 0) {
        searchParams.set('userIds', resourceIds.join(','));
      }

      const response = await authFetch(`/api/sites/${siteId}/presences?${searchParams.toString()}`);
      if (!response.ok) {
        throw new Error(`Site presences request failed with status ${response.status}`);
      }

      return (await response.json()) as PaginatedSitePresencesResponse;
    },
  });

  const resourceOptions = useMemo(() => {
    const items = new Map<string, { value: string; label: string }>();

    for (const team of teamsQuery.data ?? []) {
      for (const member of team.members) {
        if (!items.has(member.userId)) {
          items.set(member.userId, {
            value: member.userId,
            label: `${member.firstName} ${member.lastName}`,
          });
        }
      }
    }

    return [...items.values()].sort((left, right) => left.label.localeCompare(right.label));
  }, [teamsQuery.data]);

  const completeCount = (presencesQuery.data?.items ?? []).filter((item) => item.status === 'COMPLETE').length;
  const incompleteCount = (presencesQuery.data?.items ?? []).filter((item) => item.status === 'INCOMPLETE').length;
  const anomalyCount = (presencesQuery.data?.items ?? []).filter((item) => item.status === 'ANOMALY').length;

  async function handleExport() {
    try {
      const searchParams = new URLSearchParams();
      if (from) {
        searchParams.set('from', from);
      }
      if (to) {
        searchParams.set('to', to);
      }
      if (type !== 'ALL') {
        searchParams.set('type', type);
      }
      if (resourceIds.length > 0) {
        searchParams.set('userIds', resourceIds.join(','));
      }

      const response = await authFetch(`/api/sites/${siteId}/presences/export?${searchParams.toString()}`);
      if (!response.ok) {
        throw new Error(`Export request failed with status ${response.status}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `site-presences-${siteId}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);

      pushToast({
        type: 'success',
        title: 'Export CSV genere',
      });
    } catch (error) {
      pushToast({
        type: 'error',
        title: 'Export impossible',
        message: error instanceof Error ? error.message : "L'export des presences a echoue.",
      });
    }
  }

  if (siteQuery.isLoading) {
    return <LoadingCard message="Chargement du chantier..." />;
  }

  if (siteQuery.isError || !siteQuery.data) {
    return (
      <EmptyState
        ctaHref={viewer.role === 'PROJECT_MANAGER' ? '/web/my-projects' : '/web/projects'}
        ctaLabel="Retour aux projets"
        description="Le chantier est introuvable ou n'est plus accessible avec ce role."
        title="Chantier indisponible"
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Pointages chantier</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{siteQuery.data.name}</h1>
            <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-600">{siteQuery.data.address}</p>
            <p className="mt-3 text-xs uppercase tracking-[0.16em] text-slate-400">
              Geofencing {siteQuery.data.radiusKm.toFixed(1)} km
            </p>
          </div>
          <button
            className="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            onClick={() => void handleExport()}
            type="button"
          >
            Exporter cette vue
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Completes" tone="success" value={completeCount} />
        <MetricCard label="Incompletes" tone="warning" value={incompleteCount} />
        <MetricCard label="Anomalies" tone="error" value={anomalyCount} />
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="grid gap-4 xl:grid-cols-[0.9fr_0.9fr_1.2fr_1fr]">
          <Field label="Periode du">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(1);
              }}
              type="date"
              value={from}
            />
          </Field>
          <Field label="Au">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setTo(event.target.value);
                setPage(1);
              }}
              type="date"
              value={to}
            />
          </Field>
          <Field label="Ressources">
            <select
              className="min-h-32 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              multiple
              onChange={(event) => {
                const nextValues = [...event.target.selectedOptions].map((option) => option.value);
                setResourceIds(nextValues);
                setPage(1);
              }}
              value={resourceIds}
            >
              {resourceOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type de pointage">
            <select
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setType(event.target.value as 'ALL' | ClockInType);
                setPage(1);
              }}
              value={type}
            >
              <option value="ALL">Tous les types</option>
              <option value="ARRIVAL">Arrivee</option>
              <option value="DEPARTURE">Depart</option>
              <option value="INTERMEDIATE">Intermediaire</option>
              <option value="PAUSE_START">Debut pause</option>
              <option value="PAUSE_END">Fin pause</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-panel">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-6 py-4 font-semibold">Ressource</th>
                <th className="px-6 py-4 font-semibold">Date</th>
                <th className="px-6 py-4 font-semibold">Arrivee</th>
                <th className="px-6 py-4 font-semibold">Depart</th>
                <th className="px-6 py-4 font-semibold">Pauses</th>
                <th className="px-6 py-4 font-semibold">Duree reelle</th>
                <th className="px-6 py-4 font-semibold">Distance</th>
                <th className="px-6 py-4 font-semibold">Statut</th>
                <th className="px-6 py-4 font-semibold">Commentaire</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {presencesQuery.isLoading ? (
                <tr>
                  <td className="px-6 py-10 text-center text-slate-500" colSpan={9}>
                    Chargement des pointages...
                  </td>
                </tr>
              ) : (presencesQuery.data?.items.length ?? 0) === 0 ? (
                <tr>
                  <td className="px-6 py-10" colSpan={9}>
                    <EmptyState
                      description="Aucun pointage ne correspond a ces filtres sur cette periode."
                      title="Aucun pointage"
                    />
                  </td>
                </tr>
              ) : (
                presencesQuery.data?.items.map((item) => (
                  <tr key={item.id} className="align-top hover:bg-slate-50">
                    <td className="px-6 py-5 font-semibold text-slate-950">{item.resourceName}</td>
                    <td className="px-6 py-5 text-slate-600">{formatDateOnly(item.date)}</td>
                    <td className="px-6 py-5 text-slate-600">{item.arrivalTime ?? '-'}</td>
                    <td className="px-6 py-5 text-slate-600">{item.departureTime ?? '-'}</td>
                    <td className="px-6 py-5 text-slate-600">{item.pauseDurationMinutes} min</td>
                    <td className="px-6 py-5 text-slate-600">
                      {item.realDurationMinutes === null ? '-' : formatDuration(item.realDurationMinutes)}
                    </td>
                    <td className="px-6 py-5 text-slate-600">{item.distanceMeters} m</td>
                    <td className="px-6 py-5">
                      <Badge tone={presenceStatusTone(item.status)}>{presenceStatusLabel(item.status)}</Badge>
                    </td>
                    <td className="px-6 py-5 text-slate-600">{item.comment ?? '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <PaginationBar
          onNext={() => setPage((current) => current + 1)}
          onPrevious={() => setPage((current) => Math.max(1, current - 1))}
          page={presencesQuery.data?.page ?? page}
          totalPages={presencesQuery.data?.totalPages ?? 1}
        />
      </section>
    </div>
  );
}

function Field({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: Readonly<{ label: string; value: number; tone: 'success' | 'warning' | 'error' }>) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-panel">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <div className="mt-3 flex items-center justify-between gap-4">
        <p className="text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
        <Badge tone={tone}>{label}</Badge>
      </div>
    </article>
  );
}

function LoadingCard({ message }: Readonly<{ message: string }>) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

function PaginationBar({
  page,
  totalPages,
  onPrevious,
  onNext,
}: Readonly<{
  page: number;
  totalPages: number;
  onPrevious: () => void;
  onNext: () => void;
}>) {
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4 text-sm text-slate-500">
      <p>
        Page {page} / {totalPages}
      </p>
      <div className="flex gap-2">
        <button
          className="rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={page <= 1}
          onClick={onPrevious}
          type="button"
        >
          Precedent
        </button>
        <button
          className="rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={page >= totalPages}
          onClick={onNext}
          type="button"
        >
          Suivant
        </button>
      </div>
    </div>
  );
}

function presenceStatusTone(status: PaginatedSitePresencesResponse['items'][number]['status']) {
  switch (status) {
    case 'COMPLETE':
      return 'success' as const;
    case 'INCOMPLETE':
      return 'warning' as const;
    case 'ANOMALY':
      return 'error' as const;
    default:
      return 'neutral' as const;
  }
}

function presenceStatusLabel(status: PaginatedSitePresencesResponse['items'][number]['status']) {
  switch (status) {
    case 'COMPLETE':
      return 'Complete';
    case 'INCOMPLETE':
      return 'Incomplete';
    case 'ANOMALY':
      return 'Anomalie';
    default:
      return status;
  }
}

function formatDateOnly(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatDuration(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}`;
}
