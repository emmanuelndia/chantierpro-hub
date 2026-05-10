'use client';

import { PlanningAssignmentStatus, TeamMemberStatus, TeamRole } from '@prisma/client';
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { authFetch } from '@/lib/auth/client-session';
import type {
  ResourceAssignmentsHistoryResponse,
  ResourcePlanningHistoryItem,
  ResourceTeamHistoryItem,
  ResourceTodayAssignmentItem,
} from '@/types/resource-assignments-history';

type ResourceAssignmentsHistoryPageProps = Readonly<{
  userId: string;
}>;

const inputClassName =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-500';

export function ResourceAssignmentsHistoryPage({ userId }: ResourceAssignmentsHistoryPageProps) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [projectId, setProjectId] = useState('');
  const [siteId, setSiteId] = useState('');
  const filters = useMemo(() => ({ from, to, projectId, siteId }), [from, projectId, siteId, to]);

  const historyQuery = useQuery({
    queryKey: ['resource-assignments-history', userId, filters],
    queryFn: () => fetchHistory(userId, filters),
    staleTime: 30_000,
  });

  const data = historyQuery.data;
  const filteredSites = useMemo(
    () => data?.options.sites.filter((site) => !projectId || site.projectId === projectId) ?? [],
    [data?.options.sites, projectId],
  );
  const activeMemberships = data?.teamMemberships.filter((membership) => membership.status === TeamMemberStatus.ACTIVE) ?? [];
  const inactiveMemberships = data?.teamMemberships.filter((membership) => membership.status === TeamMemberStatus.INACTIVE) ?? [];

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">Ressource terrain</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              {data ? `${data.resource.firstName} ${data.resource.lastName}` : 'Historique des affectations'}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Parcours équipes, planning et affectations du jour pour une ressource terrain globale.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {data ? <Badge tone={data.resource.isActive ? 'success' : 'warning'}>{data.resource.isActive ? 'Actif' : 'Inactif'}</Badge> : null}
            {data ? <Badge tone="neutral">{data.resource.role}</Badge> : null}
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
        <div className="grid gap-4 lg:grid-cols-4">
          <Field label="Du">
            <input className={inputClassName} onChange={(event) => setFrom(event.target.value)} type="date" value={from} />
          </Field>
          <Field label="Au">
            <input className={inputClassName} onChange={(event) => setTo(event.target.value)} type="date" value={to} />
          </Field>
          <Field label="Projet">
            <select
              className={inputClassName}
              onChange={(event) => {
                setProjectId(event.target.value);
                setSiteId('');
              }}
              value={projectId}
            >
              <option value="">Tous</option>
              {data?.options.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Chantier">
            <select className={inputClassName} onChange={(event) => setSiteId(event.target.value)} value={siteId}>
              <option value="">Tous</option>
              {filteredSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      {historyQuery.isLoading ? <LoadingState /> : null}
      {historyQuery.isError ? (
        <EmptyState
          description="Cette ressource est introuvable, hors de votre perimetre ou l'historique n'a pas pu etre charge."
          title="Historique indisponible"
        />
      ) : null}

      {data ? (
        <>
          <section className="grid gap-4 md:grid-cols-4">
            <MetricCard label="Equipes actives" value={data.widgets.activeTeams} tone="success" />
            <MetricCard label="Anciennes equipes" value={data.widgets.inactiveTeams} tone="neutral" />
            <MetricCard label="Planning" value={data.widgets.planningAssignments} tone="info" />
            <MetricCard label="Aujourd'hui" value={data.widgets.todayAssignments} tone="warning" />
          </section>

          <TodayAssignmentsSection assignments={data.todayAssignments} />
          <TeamHistorySection memberships={activeMemberships} title="Equipes actives" />
          <TeamHistorySection memberships={inactiveMemberships} title="Historique equipes inactives" />
          <PlanningHistorySection assignments={data.planningAssignments} />
        </>
      ) : null}
    </div>
  );
}

function TodayAssignmentsSection({ assignments }: Readonly<{ assignments: ResourceTodayAssignmentItem[] }>) {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
      <SectionHeader count={assignments.length} title="Affectations du jour" />
      {assignments.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Aucune affectation aujourd&apos;hui.</p>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {assignments.map((assignment) => (
            <AssignmentCard assignment={assignment} key={assignment.id} />
          ))}
        </div>
      )}
    </section>
  );
}

function TeamHistorySection({
  title,
  memberships,
}: Readonly<{
  title: string;
  memberships: ResourceTeamHistoryItem[];
}>) {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
      <SectionHeader count={memberships.length} title={title} />
      {memberships.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Aucune ligne equipe.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="px-4 py-4">Equipe</th>
                <th className="px-4 py-4">Projet</th>
                <th className="px-4 py-4">Chantier</th>
                <th className="px-4 py-4">Role equipe</th>
                <th className="px-4 py-4">Periode</th>
                <th className="px-4 py-4">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {memberships.map((membership) => (
                <tr className="align-top" key={membership.id}>
                  <td className="px-4 py-4 font-semibold text-slate-950">{membership.team.name}</td>
                  <td className="px-4 py-4 text-slate-700">{membership.project.name}</td>
                  <td className="px-4 py-4 text-slate-700">{membership.site.name}</td>
                  <td className="px-4 py-4 text-slate-700">{membership.teamRole === TeamRole.TEAM_LEAD ? "Chef d'equipe" : 'Membre'}</td>
                  <td className="px-4 py-4 text-slate-700">
                    {formatDate(membership.assignmentDate)} - {membership.endDate ? formatDate(membership.endDate) : 'En cours'}
                  </td>
                  <td className="px-4 py-4">
                    <Badge tone={membership.status === TeamMemberStatus.ACTIVE ? 'success' : 'neutral'}>
                      {membership.status === TeamMemberStatus.ACTIVE ? 'Actif' : 'Inactif'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PlanningHistorySection({ assignments }: Readonly<{ assignments: ResourcePlanningHistoryItem[] }>) {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
      <SectionHeader count={assignments.length} title="Historique planning" />
      {assignments.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Aucune assignation planning.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              <tr>
                <th className="px-4 py-4">Date</th>
                <th className="px-4 py-4">Projet</th>
                <th className="px-4 py-4">Chantier</th>
                <th className="px-4 py-4">Action</th>
                <th className="px-4 py-4">Progression</th>
                <th className="px-4 py-4">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {assignments.map((assignment) => (
                <tr className="align-top" key={assignment.id}>
                  <td className="px-4 py-4 font-semibold text-slate-950">{formatDate(assignment.date)}</td>
                  <td className="px-4 py-4 text-slate-700">{assignment.project.name}</td>
                  <td className="px-4 py-4 text-slate-700">{assignment.site.name}</td>
                  <td className="max-w-sm px-4 py-4 text-slate-700">{assignment.action}</td>
                  <td className="px-4 py-4 text-slate-700">{assignment.targetProgress === null ? '-' : `${assignment.targetProgress}%`}</td>
                  <td className="px-4 py-4">
                    <StatusBadges assignment={assignment} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AssignmentCard({ assignment }: Readonly<{ assignment: ResourceTodayAssignmentItem }>) {
  return (
    <article className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-950">{assignment.site.name}</p>
          <p className="mt-1 text-sm text-slate-600">{assignment.project.name}</p>
        </div>
        <StatusBadges assignment={assignment} />
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-700">{assignment.action}</p>
      <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        Progression cible: {assignment.targetProgress === null ? '-' : `${assignment.targetProgress}%`}
      </p>
    </article>
  );
}

function StatusBadges({ assignment }: Readonly<{ assignment: ResourceTodayAssignmentItem | ResourcePlanningHistoryItem }>) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge tone={planningTone(assignment.status)}>{planningLabel(assignment.status)}</Badge>
      {assignment.deletedAt ? <Badge tone="error">Supprime</Badge> : null}
    </div>
  );
}

function SectionHeader({ title, count }: Readonly<{ title: string; count: number }>) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <Badge tone="neutral">{count}</Badge>
    </div>
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
}: Readonly<{ label: string; value: number; tone: 'success' | 'neutral' | 'info' | 'warning' }>) {
  const toneClassName = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    neutral: 'border-slate-200 bg-white text-slate-900',
    info: 'border-blue-200 bg-blue-50 text-blue-900',
    warning: 'border-orange-200 bg-orange-50 text-orange-900',
  }[tone];

  return (
    <article className={`rounded-[2rem] border p-5 shadow-panel ${toneClassName}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70">{label}</p>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
    </article>
  );
}

function LoadingState() {
  return <div className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />;
}

async function fetchHistory(userId: string, filters: { from: string; to: string; projectId: string; siteId: string }) {
  const searchParams = new URLSearchParams();
  if (filters.from) searchParams.set('from', filters.from);
  if (filters.to) searchParams.set('to', filters.to);
  if (filters.projectId) searchParams.set('projectId', filters.projectId);
  if (filters.siteId) searchParams.set('siteId', filters.siteId);
  const queryString = searchParams.toString();
  const response = await authFetch(`/api/users/${encodeURIComponent(userId)}/assignments-history${queryString ? `?${queryString}` : ''}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error(`Resource history request failed with status ${response.status}`);
  }
  return (await response.json()) as ResourceAssignmentsHistoryResponse;
}

function planningLabel(status: PlanningAssignmentStatus) {
  switch (status) {
    case PlanningAssignmentStatus.ASSIGNED:
      return 'Assigne';
    case PlanningAssignmentStatus.IN_PROGRESS:
      return 'En cours';
    case PlanningAssignmentStatus.COMPLETED:
      return 'Termine';
    case PlanningAssignmentStatus.CANCELLED:
      return 'Annule';
    default:
      return status;
  }
}

function planningTone(status: PlanningAssignmentStatus) {
  if (status === PlanningAssignmentStatus.COMPLETED) return 'success';
  if (status === PlanningAssignmentStatus.IN_PROGRESS) return 'info';
  if (status === PlanningAssignmentStatus.CANCELLED) return 'error';
  return 'warning';
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00.000Z`));
}
