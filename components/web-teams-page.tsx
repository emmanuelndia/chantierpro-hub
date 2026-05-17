'use client';

import Link from 'next/link';
import { TeamStatus } from '@prisma/client';
import { ExternalLink, Pencil } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { TableActionsMenu } from '@/components/table-actions-menu';
import { authFetch } from '@/lib/auth/client-session';
import type { WebTeamsResponse, WebTeamStatusFilter } from '@/types/web-teams';

const inputClassName =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-500';

export function WebTeamsPage() {
  const searchParams = useSearchParams();
  const [projectId, setProjectId] = useState(() => searchParams.get('projectId') ?? '');
  const [siteId, setSiteId] = useState(() => searchParams.get('siteId') ?? '');
  const [status, setStatus] = useState<WebTeamStatusFilter>('ALL');
  const [q, setQ] = useState('');

  const filters = useMemo(() => ({ projectId, siteId, status, q }), [projectId, q, siteId, status]);
  const teamsQuery = useQuery({
    queryKey: ['web-teams', filters],
    queryFn: () => fetchTeams(filters),
    staleTime: 30_000,
  });
  const data = teamsQuery.data;

  function resetSiteAndProject(nextProjectId: string) {
    setProjectId(nextProjectId);
    setSiteId('');
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">Equipes</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Gestion web des equipes</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Consulte, filtre et administre les equipes chantier depuis le web.
            </p>
          </div>
          <Link className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800" href={buildNewTeamHref(projectId, siteId)}>
            Creer une equipe
          </Link>
        </div>
      </section>

      {data ? (
        <section className="grid gap-4 md:grid-cols-4">
          <MetricCard label="Total" value={data.widgets.total} />
          <MetricCard label="Actives" value={data.widgets.active} tone="success" />
          <MetricCard label="Inactives" value={data.widgets.inactive} tone="neutral" />
          <MetricCard label="Membres actifs" value={data.widgets.members} tone="info" />
        </section>
      ) : null}

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
        <div className="grid gap-4 lg:grid-cols-4">
          <Field label="Projet">
            <select className={inputClassName} onChange={(event) => resetSiteAndProject(event.target.value)} value={projectId}>
              <option value="">Tous</option>
              {data?.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Chantier">
            <select className={inputClassName} onChange={(event) => setSiteId(event.target.value)} value={siteId}>
              <option value="">Tous</option>
              {data?.sites
                .filter((site) => !projectId || site.projectId === projectId)
                .map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Statut">
            <select className={inputClassName} onChange={(event) => setStatus(event.target.value as WebTeamStatusFilter)} value={status}>
              <option value="ALL">Tous</option>
              <option value={TeamStatus.ACTIVE}>Actives</option>
              <option value={TeamStatus.INACTIVE}>Inactives</option>
            </select>
          </Field>
          <Field label="Recherche">
            <input className={inputClassName} onChange={(event) => setQ(event.target.value)} placeholder="Equipe, site, chef..." type="search" value={q} />
          </Field>
        </div>
      </section>

      {teamsQuery.isLoading ? <LoadingState /> : null}
      {teamsQuery.isError ? <EmptyState title="Equipes indisponibles" description="Impossible de charger les equipes." /> : null}
      {data ? <TeamsTable teams={data.teams} /> : null}
    </div>
  );
}

function buildNewTeamHref(projectId: string, siteId: string) {
  const searchParams = new URLSearchParams();
  if (projectId) searchParams.set('projectId', projectId);
  if (siteId) searchParams.set('siteId', siteId);
  const queryString = searchParams.toString();
  return queryString ? `/web/teams/new?${queryString}` : '/web/teams/new';
}

function TeamsTable({ teams }: Readonly<{ teams: WebTeamsResponse['teams'] }>) {
  if (teams.length === 0) {
    return <EmptyState title="Aucune equipe" description="Aucune equipe ne correspond aux filtres selectionnes." />;
  }

  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-panel">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="px-4 py-4">Equipe</th>
              <th className="px-4 py-4">Projet</th>
              <th className="px-4 py-4">Chantier</th>
              <th className="px-4 py-4">Chef</th>
              <th className="px-4 py-4">Statut</th>
              <th className="px-4 py-4">Membres</th>
              <th className="px-4 py-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {teams.map((team) => (
              <tr className="align-top" key={team.id}>
                <td className="px-4 py-4 font-semibold text-slate-950">{team.name}</td>
                <td className="px-4 py-4 text-slate-700">{team.projectName}</td>
                <td className="px-4 py-4 text-slate-700">{team.siteName}</td>
                <td className="px-4 py-4 text-slate-700">{team.teamLeadName}</td>
                <td className="px-4 py-4">
                  <Badge tone={team.status === TeamStatus.ACTIVE ? 'success' : 'neutral'}>{team.status === TeamStatus.ACTIVE ? 'Active' : 'Inactive'}</Badge>
                </td>
                <td className="px-4 py-4 text-slate-700">
                  {team.activeMembersCount} actif(s), {team.inactiveMembersCount} historique
                </td>
                <td className="px-4 py-4">
                  <TableActionsMenu
                    actions={[
                      {
                        label: 'Ouvrir',
                        icon: <ExternalLink className="h-4 w-4" />,
                        href: `/web/teams/${team.id}`,
                        navigation: 'client',
                      },
                      {
                        label: 'Modifier',
                        icon: <Pencil className="h-4 w-4" />,
                        href: `/web/teams/${team.id}/edit`,
                        navigation: 'client',
                      },
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

async function fetchTeams(filters: { projectId: string; siteId: string; status: WebTeamStatusFilter; q: string }) {
  const searchParams = new URLSearchParams({ status: filters.status });
  if (filters.projectId) searchParams.set('projectId', filters.projectId);
  if (filters.siteId) searchParams.set('siteId', filters.siteId);
  if (filters.q) searchParams.set('q', filters.q);

  const response = await authFetch(`/api/teams/web?${searchParams.toString()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Teams request failed with status ${response.status}`);
  return (await response.json()) as WebTeamsResponse;
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
  tone = 'neutral',
}: Readonly<{ label: string; value: number; tone?: 'success' | 'neutral' | 'info' }>) {
  const className = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
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

function LoadingState() {
  return <div className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />;
}
