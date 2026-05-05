'use client';

import Link from 'next/link';
import { ProjectStatus } from '@prisma/client';
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type {
  MobileProjectListItem,
  MobileProjectsResponse,
  MobileProjectStatusFilter,
  MobileProjectWidget,
} from '@/types/mobile-projects';

type MobileProjectsPageProps = Readonly<{
  user: WebSessionUser;
}>;

const statusFilters: { value: MobileProjectStatusFilter; label: string }[] = [
  { value: 'ALL', label: 'Tous' },
  { value: ProjectStatus.IN_PROGRESS, label: 'En cours' },
  { value: ProjectStatus.COMPLETED, label: 'Terminés' },
  { value: ProjectStatus.ON_HOLD, label: 'En pause' },
  { value: ProjectStatus.ARCHIVED, label: 'Archivés' },
];

export function MobileProjectsPage({ user }: MobileProjectsPageProps) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<MobileProjectStatusFilter>('ALL');

  const requestPath = useMemo(() => {
    const params = new URLSearchParams();

    if (query.trim()) {
      params.set('q', query.trim());
    }

    if (status !== 'ALL') {
      params.set('status', status);
    }

    const queryString = params.toString();
    return queryString ? `/api/mobile/projects?${queryString}` : '/api/mobile/projects';
  }, [query, status]);

  const projectsQuery = useQuery({
    queryKey: ['mobile-projects', requestPath],
    queryFn: async () => {
      const response = await authFetch(requestPath);

      if (!response.ok) {
        throw new Error(`Mobile projects request failed with status ${response.status}`);
      }

      return (await response.json()) as MobileProjectsResponse;
    },
    staleTime: 30_000,
  });

  const data = projectsQuery.data;

  return (
    <div className="space-y-5 pb-20">
      <section className="rounded-lg border border-primary/20 bg-primary/10 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
              Portefeuille
            </p>
            <h1 className="mt-2 text-2xl font-black text-slate-950">Gestion Projets</h1>
            <p className="mt-1 truncate text-sm font-semibold text-slate-600">
              {user.role === 'DIRECTION' ? 'Vue globale active' : 'Vos projets et chantiers'}
            </p>
          </div>
          <Link
            className="flex min-h-12 shrink-0 items-center justify-center rounded-lg bg-primary px-3 text-sm font-black text-white shadow-panel transition active:scale-[0.98]"
            href="/mobile/projects/new"
          >
            Nouveau
          </Link>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-panel">
        <label className="block">
          <span className="sr-only">Rechercher un projet</span>
          <input
            className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-base font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-primary focus:bg-white"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher nom, ville, adresse, manager"
            type="search"
            value={query}
          />
        </label>

        <div className="flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
          {statusFilters.map((filter) => (
            <button
              className={`min-h-11 shrink-0 rounded-lg border px-3 text-sm font-bold transition ${
                status === filter.value
                  ? 'border-primary bg-primary text-white'
                  : 'border-slate-200 bg-white text-slate-600'
              }`}
              key={filter.value}
              onClick={() => setStatus(filter.value)}
              type="button"
            >
              {filter.label}
            </button>
          ))}
        </div>
      </section>

      {projectsQuery.isLoading ? <ProjectsLoadingState /> : null}

      {projectsQuery.isError ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          Impossible de charger les projets. Vérifiez la connexion puis réessayez.
        </section>
      ) : null}

      {data ? (
        <>
          <section className="grid grid-cols-2 gap-3">
            {data.widgets.map((widget) => (
              <WidgetTile key={widget.id} widget={widget} />
            ))}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
                Projets
              </h2>
              <span className="text-xs font-semibold text-slate-400">
                {data.projects.length} résultat{data.projects.length > 1 ? 's' : ''}
              </span>
            </div>

            {data.projects.length > 0 ? (
              <div className="space-y-3">
                {data.projects.map((project) => (
                  <ProjectCard key={project.id} project={project} />
                ))}
              </div>
            ) : (
              <EmptyState />
            )}
          </section>

          <Link
            className="fixed right-4 z-40 flex min-h-14 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-bold text-white shadow-xl shadow-slate-900/20 transition active:scale-[0.98]"
            href="/mobile/projects/new"
            style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5.5rem)' }}
          >
            <PlusIcon className="h-5 w-5" />
            Nouveau projet
          </Link>
        </>
      ) : null}
    </div>
  );
}

function WidgetTile({ widget }: Readonly<{ widget: MobileProjectWidget }>) {
  const tone = {
    total: 'border-sky-200 bg-sky-50 text-sky-800',
    active: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    completed: 'border-slate-200 bg-slate-50 text-slate-700',
    alerts: 'border-red-200 bg-red-50 text-red-700',
  }[widget.id];

  return (
    <article className={`rounded-lg border p-4 ${tone}`}>
      <div className="text-3xl font-black">{widget.value}</div>
      <div className="mt-2 text-sm font-bold text-slate-950">{widget.label}</div>
      <div className="mt-1 text-xs font-semibold text-slate-500">{widget.helper}</div>
    </article>
  );
}

function ProjectCard({ project }: Readonly<{ project: MobileProjectListItem }>) {
  return (
    <article
      className={`rounded-lg border p-4 shadow-panel ${
        project.hasAlert ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'
      }`}
    >
      <Link className="block transition active:scale-[0.99]" href={`/mobile/projects/${encodeURIComponent(project.id)}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] ${statusTone(project.status)}`}>
                {humanizeProjectStatus(project.status)}
              </span>
              {project.hasAlert ? (
                <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white">
                  Alerte
                </span>
              ) : null}
            </div>
            <h3 className="mt-3 text-base font-black leading-5 text-slate-950">{project.name}</h3>
            <p className="mt-1 truncate text-sm font-semibold text-slate-500">
              {project.city} - {project.projectManagerName}
            </p>
          </div>
          <ChevronRightIcon className="mt-2 h-5 w-5 shrink-0 text-slate-400" />
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between gap-3 text-xs font-bold text-slate-500">
            <span>Progression</span>
            <span>{project.progressPercent}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full rounded-full ${project.status === 'ON_HOLD' ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${project.progressPercent}%` }}
            />
          </div>
          <p className="mt-2 text-xs font-semibold text-slate-500">
            {formatDate(project.startDate)} - {project.endDate ? formatDate(project.endDate) : 'Fin ouverte'}
          </p>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2">
          <MetricTile label="Chantiers" value={String(project.sitesCount)} />
          <MetricTile label="Équipes" value={String(project.teamsCount)} />
          <MetricTile label="Photos" value={String(project.photosCount)} />
          <MetricTile label="Rapports" value={String(project.reportsCount)} />
        </div>
      </Link>
      <Link
        className="mt-3 flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-black text-slate-700 transition active:scale-[0.98]"
        href={`/mobile/projects/${encodeURIComponent(project.id)}/edit`}
      >
        Modifier
      </Link>
    </article>
  );
}

function MetricTile({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="min-w-0 rounded-lg bg-white/80 p-2 text-center">
      <div className="truncate text-base font-black text-slate-950">{value}</div>
      <div className="mt-1 truncate text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500">
        {label}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-white text-slate-400">
        <ProjectsIcon className="h-6 w-6" />
      </div>
      <p className="mt-4 text-base font-black text-slate-950">Aucun projet</p>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
        Aucun projet ne correspond aux filtres sélectionnés.
      </p>
    </section>
  );
}

function ProjectsLoadingState() {
  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3">
        <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
      </section>
      <section className="space-y-3">
        <div className="h-44 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-44 animate-pulse rounded-lg bg-slate-100" />
      </section>
    </div>
  );
}

function humanizeProjectStatus(status: ProjectStatus) {
  switch (status) {
    case ProjectStatus.IN_PROGRESS:
      return 'En cours';
    case ProjectStatus.COMPLETED:
      return 'Terminé';
    case ProjectStatus.ON_HOLD:
      return 'En pause';
    case ProjectStatus.ARCHIVED:
      return 'Archivé';
    default:
      return status;
  }
}

function statusTone(status: ProjectStatus) {
  switch (status) {
    case ProjectStatus.IN_PROGRESS:
      return 'bg-emerald-100 text-emerald-800';
    case ProjectStatus.COMPLETED:
      return 'bg-slate-100 text-slate-700';
    case ProjectStatus.ON_HOLD:
      return 'bg-amber-100 text-amber-800';
    case ProjectStatus.ARCHIVED:
      return 'bg-sky-100 text-sky-800';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function baseIcon(className: string, children: ReactNode) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

function ProjectsIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <path d="M4 6.5h16M4 12h16M4 17.5h10" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4Z" stroke="currentColor" strokeWidth="1.8" />
    </>,
  );
}

function PlusIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />,
  );
}

function ChevronRightIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <path d="m9 5 7 7-7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />,
  );
}
