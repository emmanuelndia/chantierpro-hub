'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Role } from '@prisma/client';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { FilterMultiSelect } from '@/components/filter-multi-select';
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
  const [regularizationTarget, setRegularizationTarget] = useState<RhUserPresenceDetail['sessions'][number] | null>(null);
  const [regularizationDate, setRegularizationDate] = useState('');
  const [regularizationTime, setRegularizationTime] = useState('17:00');
  const [regularizationComment, setRegularizationComment] = useState('');
  const [regularizationError, setRegularizationError] = useState<string | null>(null);
  const queryClient = useQueryClient();

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

  const regularizeMutation = useMutation({
    mutationFn: async (payload: { arrivalRecordId: string; departureRecordId: string | null; correctedDepartureTime: string; comment: string }) => {
      const response = await authFetch('/api/rh/presences/regularize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(error?.message ?? 'Régularisation impossible.');
      }
    },
    onSuccess: async () => {
      setRegularizationTarget(null);
      setRegularizationDate('');
      setRegularizationTime('17:00');
      setRegularizationComment('');
      setRegularizationError(null);
      await queryClient.invalidateQueries({ queryKey: ['rh-presences'] });
      await queryClient.invalidateQueries({ queryKey: ['rh-presence-detail'] });
    },
    onError: (error) => {
      setRegularizationError(error instanceof Error ? error.message : 'Régularisation impossible.');
    },
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
            <Link
              className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              href="/web/rh/export"
            >
              Exporter RH
            </Link>
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
        <div className="mb-5 flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-slate-950">Filtres de présence</h2>
          <p className="text-sm text-slate-500">Affinez la période, les ressources et les périmètres visibles.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[0.9fr_1fr_1.2fr_1.2fr]">
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
            <FilterMultiSelect
              onChange={(nextValues) => {
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
              options={(optionsQuery.data?.projects ?? []).map((project) => ({
                value: project.id,
                label: project.label,
              }))}
              placeholder="Tous les projets"
              values={projectIds}
            />
          </Field>
          <Field label="Sites">
            <FilterMultiSelect
              onChange={(nextValues) => {
                setSiteIds(nextValues);
                setExpandedUserId(null);
              }}
              options={visibleSites.map((site) => ({
                value: site.id,
                label: site.label,
              }))}
              placeholder="Tous les sites"
              values={siteIds}
            />
          </Field>
        </div>
        <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Accès</span>
          <Badge tone="neutral">{viewer.role}</Badge>
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
                    onRegularize={(session) => {
                      setRegularizationTarget(session);
                      setRegularizationDate(session.date);
                      setRegularizationTime(getDefaultRegularizationTime(session));
                      setRegularizationComment('');
                      setRegularizationError(null);
                    }}
                    row={item}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {regularizationTarget ? (
        <RegularizationModal
          comment={regularizationComment}
          date={regularizationDate}
          error={regularizationError}
          isSubmitting={regularizeMutation.isPending}
          onClose={() => {
            if (regularizeMutation.isPending) return;
            setRegularizationTarget(null);
            setRegularizationDate('');
            setRegularizationError(null);
          }}
          onCommentChange={(value) => {
            setRegularizationComment(value);
            setRegularizationError(null);
          }}
          onDateChange={(value) => {
            setRegularizationDate(value);
            setRegularizationError(null);
          }}
          onSubmit={() => {
            const comment = regularizationComment.trim();
            if (!regularizationDate || !/^\d{4}-\d{2}-\d{2}$/.test(regularizationDate)) {
              setRegularizationError('Saisis une date de sortie valide.');
              return;
            }
            if (!regularizationTime || !/^\d{2}:\d{2}$/.test(regularizationTime)) {
              setRegularizationError('Saisis une heure de sortie valide.');
              return;
            }
            if (!comment) {
              setRegularizationError('Le commentaire de régularisation est obligatoire.');
              return;
            }

            regularizeMutation.mutate({
              arrivalRecordId: regularizationTarget.arrivalRecordId,
              departureRecordId: regularizationTarget.departureRecordId,
              correctedDepartureTime: `${regularizationDate}T${regularizationTime}:00.000Z`,
              comment,
            });
          }}
          onTimeChange={(value) => {
            setRegularizationTime(value);
            setRegularizationError(null);
          }}
          session={regularizationTarget}
          time={regularizationTime}
        />
      ) : null}
    </div>
  );
}

function ResourcePresenceRow({
  row,
  expanded,
  loadingDetail,
  detail,
  onToggle,
  onRegularize,
}: Readonly<{
  row: RhPresenceSummaryItem;
  expanded: boolean;
  loadingDetail: boolean;
  detail: RhUserPresenceDetail | null;
  onToggle: () => void;
  onRegularize: (session: RhUserPresenceDetail['sessions'][number]) => void;
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
                        <th className="px-4 py-3 font-semibold">Arrivée</th>
                        <th className="px-4 py-3 font-semibold">Départ</th>
                        <th className="px-4 py-3 font-semibold">Pauses</th>
                        <th className="px-4 py-3 font-semibold">Durée réelle</th>
                        <th className="px-4 py-3 font-semibold">Commentaire</th>
                        <th className="px-4 py-3 font-semibold">Statut</th>
                        <th className="px-4 py-3 font-semibold">Action</th>
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
                            <Badge tone={session.incomplete || session.status === 'TO_REVIEW_RH' ? 'warning' : 'success'}>
                              {sessionLabel(session.status)}
                            </Badge>
                            {session.isRemoteCheckout ? (
                              <span className="ml-2 rounded-full bg-orange-100 px-2 py-1 text-[10px] font-bold uppercase text-orange-700">
                                Distance
                              </span>
                            ) : null}
                            {session.isRegularized ? (
                              <span className="ml-2 rounded-full bg-blue-100 px-2 py-1 text-[10px] font-bold uppercase text-blue-700">
                                Régularisé
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-3">
                            {session.incomplete || session.status === 'TO_REVIEW_RH' ? (
                              <button
                                className="rounded-full border border-orange-200 px-3 py-2 text-xs font-bold text-orange-700 transition hover:bg-orange-50"
                                onClick={() => onRegularize(session)}
                                type="button"
                              >
                                Régulariser
                              </button>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
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

function RegularizationModal({
  session,
  date,
  time,
  comment,
  error,
  isSubmitting,
  onDateChange,
  onTimeChange,
  onCommentChange,
  onSubmit,
  onClose,
}: Readonly<{
  session: RhUserPresenceDetail['sessions'][number];
  date: string;
  time: string;
  comment: string;
  error: string | null;
  isSubmitting: boolean;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onCommentChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}>) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6 backdrop-blur-sm">
      <section className="w-full max-w-lg rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Régularisation RH</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Corriger la sortie</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {session.siteName} · {formatDateOnly(session.date)} · entrée {session.arrivalTime.slice(0, 5)}
            </p>
          </div>
          <button
            aria-label="Fermer"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:bg-slate-50"
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <Field label="Date de sortie corrigée">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              disabled={isSubmitting}
              onChange={(event) => onDateChange(event.target.value)}
              type="date"
              value={date}
            />
          </Field>
          <Field label="Heure de sortie corrigée">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              disabled={isSubmitting}
              onChange={(event) => onTimeChange(event.target.value)}
              type="time"
              value={time}
            />
          </Field>
          <Field label="Commentaire obligatoire">
            <textarea
              className="min-h-28 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              disabled={isSubmitting}
              onChange={(event) => onCommentChange(event.target.value)}
              placeholder="Explique pourquoi la sortie est corrigée."
              value={comment}
            />
          </Field>
          {error ? (
            <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            className="rounded-full border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
          >
            Annuler
          </button>
          <button
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
            onClick={onSubmit}
            type="button"
          >
            {isSubmitting ? 'Régularisation...' : 'Valider la régularisation'}
          </button>
        </div>
      </section>
    </div>
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

function getDefaultRegularizationTime(session: RhUserPresenceDetail['sessions'][number]) {
  if (session.departureTime) {
    return session.departureTime.slice(0, 5);
  }

  const [hours = 0, minutes = 0] = session.arrivalTime.split(':').map(Number);
  if (hours < 17 || (hours === 17 && minutes === 0)) {
    return '17:00';
  }

  const nextHour = Math.min(hours + 1, 23);
  return `${String(nextHour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatDateOnly(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function sessionLabel(status: RhUserPresenceDetail['sessions'][number]['status']) {
  switch (status) {
    case 'COMPLETE':
      return 'Valide';
    case 'TO_REVIEW_RH':
      return 'A vérifier RH';
    case 'TO_REGULARIZE':
      return 'A régulariser';
    case 'INCOMPLETE_SESSION':
    default:
      return 'Incomplète';
  }
}
