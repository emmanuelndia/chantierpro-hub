'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { authFetch } from '@/lib/auth/client-session';
import type { ProjectProgressItem, ProjectProgressResponse, ProjectProgressStatus } from '@/types/project-progress';

const statusFilters: { value: '' | ProjectProgressStatus; label: string }[] = [
  { value: '', label: 'Tous les projets' },
  { value: 'LATE', label: 'En retard' },
  { value: 'AT_RISK', label: 'À surveiller' },
  { value: 'ON_TRACK', label: 'Dans les temps' },
  { value: 'COMPLETED', label: 'Terminés' },
];

export function ProjectProgressPage() {
  const [status, setStatus] = useState<'' | ProjectProgressStatus>('');
  const [search, setSearch] = useState('');

  const progressQuery = useQuery({
    queryKey: ['project-progress'],
    queryFn: async () => {
      const response = await authFetch('/api/projects/progress', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Project progress failed with status ${response.status}`);
      }

      return (await response.json()) as ProjectProgressResponse;
    },
    staleTime: 60_000,
  });

  const data = progressQuery.data;
  const items = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return (data?.items ?? []).filter((item) => {
      const matchesStatus = !status || item.progressStatus === status;
      const matchesSearch =
        !normalizedSearch ||
        `${item.projectName} ${item.projectManagerName} ${item.alerts.join(' ')}`.toLowerCase().includes(normalizedSearch);
      return matchesStatus && matchesSearch;
    });
  }, [data?.items, search, status]);

  if (progressQuery.isLoading && !data) {
    return <p className="rounded-[2rem] border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-500 shadow-panel">Chargement de la progression projets...</p>;
  }

  if (progressQuery.isError) {
    return <EmptyState title="Progression indisponible" description="La synthèse des projets ne peut pas être chargée." />;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Pilotage</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Progression projets</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Vue de synthèse pour identifier les projets en retard, les tâches bloquées et les chantiers qui demandent une action.
            </p>
          </div>
          <button
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={() => void progressQuery.refetch()}
            type="button"
          >
            Actualiser
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard label="Projets" value={data?.summary.projects ?? 0} />
        <KpiCard label="Progression moyenne" suffix="%" value={data?.summary.averageProgress ?? 0} />
        <KpiCard label="En retard" tone="danger" value={data?.summary.lateProjects ?? 0} />
        <KpiCard label="À surveiller" tone="warning" value={data?.summary.atRiskProjects ?? 0} />
        <KpiCard label="Tâches bloquées" tone="warning" value={data?.summary.blockedTasks ?? 0} />
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="grid gap-4 md:grid-cols-[1fr_220px]">
          <input
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Rechercher projet, chef projet ou alerte"
            type="search"
            value={search}
          />
          <select
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
            onChange={(event) => setStatus(event.target.value as '' | ProjectProgressStatus)}
            value={status}
          >
            {statusFilters.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="space-y-4">
        {items.length === 0 ? (
          <EmptyState title="Aucun projet" description="Aucun projet ne correspond aux filtres." />
        ) : (
          items.map((item) => <ProjectProgressCard item={item} key={item.projectId} />)
        )}
      </section>
    </div>
  );
}

function ProjectProgressCard({ item }: Readonly<{ item: ProjectProgressItem }>) {
  return (
    <article className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold text-slate-950">{item.projectName}</h2>
            <Badge tone={progressTone(item.progressStatus)}>{progressLabel(item.progressStatus)}</Badge>
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-500">Chef projet : {item.projectManagerName}</p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            {item.startDate} - {item.endDate ?? 'date fin non renseignée'}
          </p>
        </div>
        <div className="min-w-[180px]">
          <p className="text-right text-3xl font-black text-slate-950">{item.globalProgress}%</p>
          <div className="mt-2 h-2 rounded-full bg-slate-100">
            <div
              className={`h-2 rounded-full ${progressBarClassName(item.progressStatus)}`}
              style={{ width: `${Math.min(100, Math.max(0, item.globalProgress))}%` }}
            />
          </div>
        </div>
      </div>

      {item.alerts.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {item.alerts.map((alert) => (
            <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-800" key={alert}>
              {alert}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="Sites actifs" value={item.sites.active} detail={`${item.sites.completed}/${item.sites.total} terminés`} />
        <Metric label="Sites en retard" value={item.sites.late} />
        <Metric label="Tâches atteintes" value={item.tasks.achieved} detail={`${item.tasks.total} tâche(s)`} />
        <Metric label="Tâches en retard" value={item.tasks.late} detail={`${item.tasks.blocked} bloquée(s)`} />
      </div>
    </article>
  );
}

function KpiCard({
  label,
  value,
  suffix = '',
  tone = 'neutral',
}: Readonly<{
  label: string;
  value: number;
  suffix?: string;
  tone?: 'neutral' | 'warning' | 'danger';
}>) {
  const className = {
    neutral: 'border-slate-200 bg-white text-slate-950',
    warning: 'border-orange-200 bg-orange-50 text-orange-950',
    danger: 'border-red-200 bg-red-50 text-red-950',
  }[tone];

  return (
    <article className={`rounded-[2rem] border p-5 shadow-panel ${className}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-70">{label}</p>
      <p className="mt-3 text-3xl font-semibold">
        {value}
        {suffix}
      </p>
    </article>
  );
}

function Metric({ label, value, detail }: Readonly<{ label: string; value: number; detail?: string }>) {
  return (
    <div className="rounded-2xl bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
      {detail ? <p className="mt-1 text-xs font-semibold text-slate-500">{detail}</p> : null}
    </div>
  );
}

function progressLabel(status: ProjectProgressStatus) {
  const labels: Record<ProjectProgressStatus, string> = {
    ON_TRACK: 'Dans les temps',
    AT_RISK: 'À surveiller',
    LATE: 'En retard',
    COMPLETED: 'Terminé',
  };
  return labels[status];
}

function progressTone(status: ProjectProgressStatus) {
  if (status === 'COMPLETED' || status === 'ON_TRACK') return 'success';
  if (status === 'LATE') return 'error';
  return 'warning';
}

function progressBarClassName(status: ProjectProgressStatus) {
  if (status === 'COMPLETED' || status === 'ON_TRACK') return 'bg-emerald-500';
  if (status === 'LATE') return 'bg-red-500';
  return 'bg-orange-500';
}
