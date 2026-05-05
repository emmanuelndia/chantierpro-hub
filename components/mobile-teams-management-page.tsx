'use client';

import { TeamStatus } from '@prisma/client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type { MobileTeamsManagementResponse, MobileTeamStatusFilter } from '@/types/mobile-teams';

type MobileTeamsManagementPageProps = Readonly<{
  user: WebSessionUser;
}>;

const statusFilters: { id: MobileTeamStatusFilter; label: string }[] = [
  { id: 'ALL', label: 'Toutes' },
  { id: TeamStatus.ACTIVE, label: 'Actives' },
  { id: TeamStatus.INACTIVE, label: 'Inactives' },
];

export function MobileTeamsManagementPage({ user }: MobileTeamsManagementPageProps) {
  const [status, setStatus] = useState<MobileTeamStatusFilter>('ALL');
  const [projectId, setProjectId] = useState('ALL');
  const [siteId, setSiteId] = useState('ALL');
  const [query, setQuery] = useState('');

  const teamsQuery = useQuery({
    queryKey: ['mobile-teams-management', status, projectId, siteId, query],
    queryFn: async () => {
      const searchParams = new URLSearchParams();

      if (status !== 'ALL') searchParams.set('status', status);
      if (projectId !== 'ALL') searchParams.set('projectId', projectId);
      if (siteId !== 'ALL') searchParams.set('siteId', siteId);
      if (query.trim()) searchParams.set('q', query.trim());

      const response = await authFetch(`/api/mobile/teams/management?${searchParams.toString()}`);

      if (!response.ok) {
        throw new Error(`Teams management request failed with status ${response.status}`);
      }

      return (await response.json()) as MobileTeamsManagementResponse;
    },
    staleTime: 30_000,
  });

  const data = teamsQuery.data;
  const visibleSites = useMemo(() => {
    const sites = data?.sites ?? [];
    if (projectId === 'ALL') return sites;

    return sites.filter((site) => site.projectId === projectId);
  }, [data?.sites, projectId]);

  return (
    <div className="space-y-5 pb-20">
      <section className="rounded-lg border border-primary/20 bg-primary/10 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Gestion équipes</p>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-black leading-7 text-slate-950">{getTitleForRole(user.role)}</h1>
            <p className="mt-1 text-sm font-semibold text-slate-600">Chantiers, responsables et membres actifs</p>
          </div>
          {data?.canMutate ? (
            <Link
              className="flex min-h-12 shrink-0 items-center justify-center rounded-lg bg-primary px-3 text-sm font-black text-white shadow-panel"
              href={siteId === 'ALL' ? '/mobile/teams/new' : `/mobile/teams/new?siteId=${encodeURIComponent(siteId)}`}
            >
              Nouvelle
            </Link>
          ) : null}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <MetricCard label="Équipes" value={data?.widgets.total ?? 0} />
        <MetricCard label="Actives" value={data?.widgets.active ?? 0} />
        <MetricCard label="Inactives" value={data?.widgets.inactive ?? 0} />
        <MetricCard label="Membres" value={data?.widgets.members ?? 0} />
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-panel">
        <label className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500" htmlFor="team-search">
          Recherche
        </label>
        <input
          className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-primary"
          id="team-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Équipe, chantier, projet ou chef"
          type="search"
          value={query}
        />
        <div className="flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
          {statusFilters.map((item) => (
            <button
              className={`min-h-11 shrink-0 rounded-lg px-3 text-xs font-black transition ${
                status === item.id ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600'
              }`}
              key={item.id}
              onClick={() => setStatus(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        {data && data.projects.length > 1 ? (
          <select
            className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none focus:border-primary"
            onChange={(event) => {
              setProjectId(event.target.value);
              setSiteId('ALL');
            }}
            value={projectId}
          >
            <option value="ALL">Tous les projets</option>
            {data.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        ) : null}
        {visibleSites.length > 1 ? (
          <select
            className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none focus:border-primary"
            onChange={(event) => setSiteId(event.target.value)}
            value={siteId}
          >
            <option value="ALL">Tous les chantiers</option>
            {visibleSites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        ) : null}
      </section>

      {teamsQuery.isLoading ? <TeamsLoadingState /> : null}
      {teamsQuery.isError ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          Impossible de charger les équipes.
        </section>
      ) : null}
      {!teamsQuery.isLoading && data?.teams.length === 0 ? (
        <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
          <h2 className="text-lg font-black text-slate-950">Aucune équipe</h2>
          <p className="mt-2 text-sm font-semibold text-slate-500">Aucune équipe ne correspond aux filtres sélectionnés.</p>
        </section>
      ) : null}

      <section className="space-y-3">
        {data?.teams.map((team) => (
          <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel" key={team.id}>
            <Link className="block transition active:scale-[0.99]" href={`/mobile/teams/${encodeURIComponent(team.id)}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className={`rounded-full px-2 py-1 text-[11px] font-black ${teamStatusTone(team.status)}`}>
                    {formatTeamStatus(team.status)}
                  </span>
                  <h2 className="mt-3 truncate text-base font-black text-slate-950">{team.name}</h2>
                  <p className="mt-1 truncate text-sm font-bold text-slate-500">{team.projectName}</p>
                  <p className="mt-1 truncate text-xs font-bold text-slate-400">{team.siteName}</p>
                </div>
                <span className="text-lg font-black text-slate-300">›</span>
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-600">Chef : {team.teamLeadName}</p>
            </Link>
            <div className="mt-3 flex items-center gap-2">
              {team.membersPreview.map((member) => (
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black text-slate-600"
                  key={member.id}
                  title={`${member.firstName} ${member.lastName}`}
                >
                  {member.firstName[0]}
                  {member.lastName[0]}
                </span>
              ))}
              {team.activeMembersCount > team.membersPreview.length ? (
                <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-slate-200 px-2 text-xs font-black text-slate-600">
                  +{team.activeMembersCount - team.membersPreview.length}
                </span>
              ) : null}
              <span className="ml-auto text-xs font-bold text-slate-500">
                {team.activeMembersCount}/{team.membersCount} actifs
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link
                className="flex min-h-11 items-center justify-center rounded-lg bg-primary text-xs font-black text-white"
                href={`/mobile/teams/${encodeURIComponent(team.id)}`}
              >
                Voir détails
              </Link>
              {data.canMutate ? (
                <Link
                  className="flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-xs font-black text-slate-700"
                  href={`/mobile/teams/${encodeURIComponent(team.id)}/edit`}
                >
                  Modifier
                </Link>
              ) : null}
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

export function formatTeamStatus(status: TeamStatus) {
  return status === TeamStatus.ACTIVE ? 'Active' : 'Inactive';
}

export function teamStatusTone(status: TeamStatus) {
  return status === TeamStatus.ACTIVE ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700';
}

function getTitleForRole(role: WebSessionUser['role']) {
  if (role === 'COORDINATOR') return 'Mes équipes';
  if (role === 'GENERAL_SUPERVISOR') return 'Équipes de mon périmètre';
  return 'Toutes les équipes';
}

function MetricCard({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
      <p className="text-2xl font-black text-slate-950">{value}</p>
      <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
    </article>
  );
}

function TeamsLoadingState() {
  return (
    <section className="space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="h-44 animate-pulse rounded-lg bg-slate-100" key={index} />
      ))}
    </section>
  );
}
