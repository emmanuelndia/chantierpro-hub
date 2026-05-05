'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Role } from '@prisma/client';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { StatsCard } from '@/components/stats-card';
import { authFetch } from '@/lib/auth/client-session';
import type {
  RhOptionsResponse,
  RhPresenceSummaryItem,
  RhPresencesResponse,
  RhUserPresenceDetail,
} from '@/types/rh';
import type { DashboardStat } from '@/types/dashboard';

type RhPresencesPageProps = Readonly<{
  viewer: {
    role: Role;
  };
}>;

export function RhPresencesPage({ viewer }: RhPresencesPageProps) {
  const currentMonth = new Date();
  const [month, setMonth] = useState(currentMonth.getUTCMonth() + 1);
  const [year, setYear] = useState(currentMonth.getUTCFullYear());
  const [search, setSearch] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const monthOptions = useMemo(() => buildMonthOptions(), []);

  const optionsQuery = useQuery({
    queryKey: ['rh-options'],
    queryFn: async () => {
      const response = await authFetch('/api/rh/options');
      if (!response.ok) {
        throw new Error(`RH options request failed with status ${response.status}`);
      }

      return (await response.json()) as RhOptionsResponse;
    },
  });

  const presencesQuery = useQuery({
    queryKey: ['rh-presences', month, year, search, projectIds, siteIds],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      searchParams.set('month', String(month));
      searchParams.set('year', String(year));
      if (search.trim()) {
        searchParams.set('search', search.trim());
      }
      if (projectIds.length > 0) {
        searchParams.set('projectId', projectIds[0]!);
      }
      if (siteIds.length > 0) {
        searchParams.set('siteIds', siteIds.join(','));
      }

      const response = await authFetch(`/api/rh/presences?${searchParams.toString()}`);
      if (!response.ok) {
        throw new Error(`RH presences request failed with status ${response.status}`);
      }

      return (await response.json()) as RhPresencesResponse;
    },
  });

  const expandedDetailQuery = useQuery({
    queryKey: ['rh-presence-detail', expandedUserId, month, year, projectIds, siteIds],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      searchParams.set('month', String(month));
      searchParams.set('year', String(year));
      if (projectIds.length > 0) {
        searchParams.set('projectId', projectIds[0]!);
      }
      if (siteIds.length > 0) {
        searchParams.set('siteIds', siteIds.join(','));
      }

      const response = await authFetch(
        `/api/rh/presences/${expandedUserId}?${searchParams.toString()}`,
      );
      if (!response.ok) {
        throw new Error(`RH presence detail request failed with status ${response.status}`);
      }

      return (await response.json()) as RhUserPresenceDetail;
    },
    enabled: expandedUserId !== null,
  });

  const visibleSites = useMemo(() => {
    const allSites = optionsQuery.data?.sites ?? [];
    if (projectIds.length === 0) {
      return allSites;
    }

    const allowed = new Set(projectIds);
    return allSites.filter((site) => allowed.has(site.projectId));
  }, [optionsQuery.data?.sites, projectIds]);

  const stats = useMemo<DashboardStat[]>(() => {
    const summary = presencesQuery.data?.summary;

    return [
      {
        icon: 'clock',
        label: 'Heures hors pauses',
        value: `${(summary?.totalHours ?? 0).toFixed(2)} h`,
        tone: 'primary',
      },
      {
        icon: 'users',
        label: 'Ressources actives',
        value: String(summary?.activeResources ?? 0),
        tone: 'success',
      },
      {
        icon: 'sites',
        label: 'Sites',
        value: String(summary?.sitesCount ?? 0),
        tone: 'neutral',
      },
      {
        icon: 'alerts',
        label: 'Sessions incompletes',
        value: String(summary?.incompleteSessions ?? 0),
        tone: (summary?.incompleteSessions ?? 0) > 0 ? 'warning' : 'neutral',
      },
    ];
  }, [presencesQuery.data?.summary]);

  if (presencesQuery.isLoading && !presencesQuery.data) {
    return <LoadingState />;
  }

  if (presencesQuery.isError) {
    return (
      <EmptyState
        description="Les donnees RH n'ont pas pu etre chargees pour le moment."
        title="Module RH indisponible"
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
              Presences / RH
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              Suivi mensuel des ressources
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Analyse les heures reelles, les pauses et les sessions incompletes sans quitter le shell web.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              onClick={() => {
                const now = new Date();
                setMonth(now.getUTCMonth() + 1);
                setYear(now.getUTCFullYear());
              }}
              type="button"
            >
              Ce mois
            </button>
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              onClick={() => {
                const previous = new Date(Date.UTC(year, month - 2, 1));
                setMonth(previous.getUTCMonth() + 1);
                setYear(previous.getUTCFullYear());
              }}
              type="button"
            >
              Mois precedent
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => (
          <StatsCard key={stat.label} stat={stat} />
        ))}
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="grid gap-4 xl:grid-cols-[0.9fr_0.9fr_1.2fr_1fr_1fr]">
          <Field label="Mois / annee">
            <select
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                const [nextYear, nextMonth] = event.target.value.split('-').map(Number);
                setYear(nextYear!);
                setMonth(nextMonth!);
                setExpandedUserId(null);
              }}
              value={`${year}-${String(month).padStart(2, '0')}`}
            >
              {monthOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Recherche ressource">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nom, prenom, email..."
              value={search}
            />
          </Field>
          <Field label="Projets">
            <select
              className="min-h-32 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              multiple
              onChange={(event) => {
                const nextValues = [...event.target.selectedOptions].map((option) => option.value);
                setProjectIds(nextValues);
                setSiteIds((current) =>
                  current.filter((siteId) =>
                    (optionsQuery.data?.sites ?? []).some(
                      (site) => site.id === siteId && nextValues.includes(site.projectId),
                    ),
                  ),
                );
                setExpandedUserId(null);
              }}
              value={projectIds}
            >
              {(optionsQuery.data?.projects ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sites">
            <select
              className="min-h-32 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              multiple
              onChange={(event) => {
                setSiteIds([...event.target.selectedOptions].map((option) => option.value));
                setExpandedUserId(null);
              }}
              value={siteIds}
            >
              {visibleSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Acces">
            <div className="flex h-full items-center rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
              {viewer.role}
            </div>
          </Field>
        </div>
      </section>

      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-panel">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-6 py-4 font-semibold">Nom</th>
                <th className="px-6 py-4 font-semibold">Prenom</th>
                <th className="px-6 py-4 font-semibold">Role</th>
                <th className="px-6 py-4 font-semibold">Nb jours</th>
                <th className="px-6 py-4 font-semibold">Heures reelles</th>
                <th className="px-6 py-4 font-semibold">Heures pauses</th>
                <th className="px-6 py-4 font-semibold">Moy/jour</th>
                <th className="px-6 py-4 font-semibold">Nb sites</th>
                <th className="px-6 py-4 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(presencesQuery.data?.items.length ?? 0) === 0 ? (
                <tr>
                  <td className="px-6 py-10" colSpan={9}>
                    <EmptyState
                      description="Aucune presence RH ne correspond aux filtres actifs."
                      title="Aucune ressource a afficher"
                    />
                  </td>
                </tr>
              ) : (
                presencesQuery.data?.items.map((item) => (
                  <ResourcePresenceRow
                    key={item.userId}
                    detail={expandedUserId === item.userId ? expandedDetailQuery.data ?? null : null}
                    expanded={expandedUserId === item.userId}
                    loadingDetail={expandedUserId === item.userId && expandedDetailQuery.isLoading}
                    onToggle={() =>
                      setExpandedUserId((current) => (current === item.userId ? null : item.userId))
                    }
                    row={item}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ResourcePresenceRow({
  row,
  expanded,
  loadingDetail,
  detail,
  onToggle,
}: Readonly<{
  row: RhPresenceSummaryItem;
  expanded: boolean;
  loadingDetail: boolean;
  detail: RhUserPresenceDetail | null;
  onToggle: () => void;
}>) {
  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-6 py-5 font-semibold text-slate-950">{row.lastName}</td>
        <td className="px-6 py-5 text-slate-600">{row.firstName}</td>
        <td className="px-6 py-5">
          <Badge tone="info">{row.role}</Badge>
        </td>
        <td className="px-6 py-5 text-slate-600">{row.nbDays}</td>
        <td className="px-6 py-5 text-slate-600">{row.totalHours.toFixed(2)} h</td>
        <td className="px-6 py-5 text-slate-600">{row.totalPauseDuration.toFixed(2)} h</td>
        <td className="px-6 py-5 text-slate-600">{row.avgHoursPerDay.toFixed(2)} h</td>
        <td className="px-6 py-5 text-slate-600">{row.sitesCount}</td>
        <td className="px-6 py-5">
          <button
            className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
            onClick={onToggle}
            type="button"
          >
            {expanded ? 'Masquer' : 'Voir detail'}
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr className="bg-slate-50/70">
          <td className="px-6 py-5" colSpan={9}>
            {loadingDetail ? (
              <div className="rounded-3xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                Chargement des sessions...
              </div>
            ) : detail ? (
              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Date</th>
                        <th className="px-4 py-3 font-semibold">Site</th>
                        <th className="px-4 py-3 font-semibold">Arrivee</th>
                        <th className="px-4 py-3 font-semibold">Depart</th>
                        <th className="px-4 py-3 font-semibold">Pauses</th>
                        <th className="px-4 py-3 font-semibold">Duree reelle</th>
                        <th className="px-4 py-3 font-semibold">Commentaire</th>
                        <th className="px-4 py-3 font-semibold">Statut</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {detail.sessions.map((session, index) => (
                        <tr key={`${session.siteId}:${session.date}:${index}`}>
                          <td className="px-4 py-3 text-slate-600">{formatDateOnly(session.date)}</td>
                          <td className="px-4 py-3 text-slate-600">{session.siteName}</td>
                          <td className="px-4 py-3 text-slate-600">{session.arrivalTime}</td>
                          <td className="px-4 py-3 text-slate-600">{session.departureTime ?? '-'}</td>
                          <td className="px-4 py-3 text-slate-600">{session.pauseDurationHours.toFixed(2)} h</td>
                          <td className="px-4 py-3 text-slate-600">
                            {session.realDurationHours === null ? '-' : `${session.realDurationHours.toFixed(2)} h`}
                          </td>
                          <td className="px-4 py-3 text-slate-600">{session.comment ?? '-'}</td>
                          <td className="px-4 py-3">
                            <Badge tone={session.incomplete ? 'warning' : 'success'}>
                              {session.incomplete ? 'Incomplete' : 'Valide'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="rounded-3xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
                Aucun detail disponible.
              </div>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Field({
  label,
  children,
}: Readonly<{
  label: string;
  children: ReactNode;
}>) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="h-4 w-40 animate-pulse rounded-full bg-slate-200" />
        <div className="mt-4 h-10 w-80 animate-pulse rounded-full bg-slate-200" />
      </section>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-36 animate-pulse rounded-3xl border border-slate-200 bg-white shadow-panel" />
        ))}
      </section>
    </div>
  );
}

function buildMonthOptions() {
  const now = new Date();
  return Array.from({ length: 13 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    const month = date.getUTCMonth() + 1;
    const year = date.getUTCFullYear();

    return {
      value: `${year}-${String(month).padStart(2, '0')}`,
      label: new Intl.DateTimeFormat('fr-FR', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date),
    };
  });
}

function formatDateOnly(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
  }).format(new Date(`${value}T00:00:00.000Z`));
}
