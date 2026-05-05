'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type {
  MobileManagementPresenceResource,
  MobileManagementPresenceSite,
  MobileManagementPresencesResponse,
  MobileManagementPresencesWidget,
} from '@/types/mobile-management-presences';

type PresenceStatusFilter = 'all' | 'present' | 'paused' | 'alerts';

type MobileManagementPresencesPageProps = Readonly<{
  user: WebSessionUser;
}>;

const statusFilters: { value: PresenceStatusFilter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'present', label: 'Présents' },
  { value: 'paused', label: 'En pause' },
  { value: 'alerts', label: 'Alertes' },
];

export function MobileManagementPresencesPage({ user }: MobileManagementPresencesPageProps) {
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState('all');
  const [status, setStatus] = useState<PresenceStatusFilter>('all');

  const requestPath = useMemo(() => {
    const params = new URLSearchParams();

    if (query.trim()) {
      params.set('q', query.trim());
    }

    if (projectId !== 'all') {
      params.set('projectId', projectId);
    }

    if (status !== 'all') {
      params.set('status', status);
    }

    const queryString = params.toString();
    return queryString ? `/api/mobile/presences?${queryString}` : '/api/mobile/presences';
  }, [projectId, query, status]);

  const presencesQuery = useQuery({
    queryKey: ['mobile-management-presences', requestPath],
    queryFn: async () => {
      const response = await authFetch(requestPath);

      if (!response.ok) {
        throw new Error(`Mobile presences request failed with status ${response.status}`);
      }

      return (await response.json()) as MobileManagementPresencesResponse;
    },
    staleTime: 30_000,
  });

  const data = presencesQuery.data;

  return (
    <div className="space-y-5 pb-20">
      <section className="rounded-lg border border-primary/20 bg-primary/10 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
            <PresenceIcon className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-black text-slate-950">Présences</p>
            <p className="mt-1 truncate text-sm font-semibold text-slate-600">
              Suivi multi-chantiers pour {user.firstName}
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-panel">
        <label className="block">
          <span className="sr-only">Rechercher</span>
          <input
            className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-base font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-primary focus:bg-white"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un chantier, projet, ressource"
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

        {data?.projects.length ? (
          <div className="flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
            <button
              className={`min-h-11 shrink-0 rounded-lg border px-3 text-sm font-bold transition ${
                projectId === 'all'
                  ? 'border-slate-950 bg-slate-950 text-white'
                  : 'border-slate-200 bg-white text-slate-600'
              }`}
              onClick={() => setProjectId('all')}
              type="button"
            >
              Tous les projets
            </button>
            {data.projects.map((project) => (
              <button
                className={`min-h-11 shrink-0 rounded-lg border px-3 text-sm font-bold transition ${
                  projectId === project.id
                    ? 'border-slate-950 bg-slate-950 text-white'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
                key={project.id}
                onClick={() => setProjectId(project.id)}
                type="button"
              >
                {project.name}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      {presencesQuery.isLoading ? <PresencesLoadingState /> : null}

      {presencesQuery.isError ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          Impossible de charger les présences. Vérifiez la connexion puis réessayez.
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
                Chantiers
              </h2>
              <span className="text-xs font-semibold text-slate-400">
                {data.sites.length} résultat{data.sites.length > 1 ? 's' : ''}
              </span>
            </div>

            {data.sites.length > 0 ? (
              <div className="space-y-3">
                {data.sites.map((site) => (
                  <PresenceSiteCard key={site.id} site={site} />
                ))}
              </div>
            ) : (
              <EmptyState />
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function WidgetTile({ widget }: Readonly<{ widget: MobileManagementPresencesWidget }>) {
  const tone = {
    present: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    paused: 'border-amber-200 bg-amber-50 text-amber-800',
    absent: 'border-slate-200 bg-slate-50 text-slate-700',
    activeSites: 'border-primary/20 bg-primary/10 text-primary',
  }[widget.id];

  return (
    <article className={`rounded-lg border p-4 ${tone}`}>
      <div className="text-3xl font-black">{widget.value}</div>
      <div className="mt-2 text-sm font-bold text-slate-950">{widget.label}</div>
      <div className="mt-1 text-xs font-semibold text-slate-500">{widget.helper}</div>
    </article>
  );
}

function PresenceSiteCard({ site }: Readonly<{ site: MobileManagementPresenceSite }>) {
  const alert = site.presentCount === 0;
  const previewResources = site.resources.slice(0, 4);

  return (
    <Link
      className={`block rounded-lg border p-4 shadow-panel transition active:scale-[0.99] ${
        alert ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'
      }`}
      href={`/mobile/sites/${encodeURIComponent(site.id)}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {alert ? (
              <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white">
                Alerte
              </span>
            ) : null}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
              {formatSiteStatus(site.status)}
            </span>
          </div>
          <h3 className="mt-3 truncate text-base font-black text-slate-950">{site.name}</h3>
          <p className="mt-1 truncate text-sm font-semibold text-slate-500">{site.projectName}</p>
        </div>
        <ChevronRightIcon className="mt-2 h-5 w-5 shrink-0 text-slate-400" />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <MetricTile label="Présents" value={`${site.presentCount}/${site.totalResources}`} />
        <MetricTile label="Pause" value={String(site.pausedCount)} />
        <MetricTile label="Dernier" value={formatClockInTime(site.lastClockInAt)} />
      </div>

      <div className="mt-4 space-y-2">
        {previewResources.length > 0 ? (
          previewResources.map((resource) => (
            <ResourceRow key={resource.userId} resource={resource} />
          ))
        ) : (
          <p className="rounded-lg bg-white/70 p-3 text-sm font-semibold text-slate-500">
            Aucune ressource active affectée.
          </p>
        )}
        {site.resources.length > previewResources.length ? (
          <p className="text-xs font-bold text-slate-400">
            +{site.resources.length - previewResources.length} autre
            {site.resources.length - previewResources.length > 1 ? 's' : ''} ressource
          </p>
        ) : null}
      </div>
    </Link>
  );
}

function MetricTile({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="min-w-0 rounded-lg bg-white/80 p-2">
      <div className="truncate text-base font-black text-slate-950">{value}</div>
      <div className="mt-1 truncate text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
        {label}
      </div>
    </div>
  );
}

function ResourceRow({ resource }: Readonly<{ resource: MobileManagementPresenceResource }>) {
  const tone = {
    PRESENT: 'bg-emerald-100 text-emerald-800',
    PAUSED: 'bg-amber-100 text-amber-800',
    ABSENT: 'bg-slate-100 text-slate-600',
  }[resource.status];

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-white/80 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-black text-slate-950">{resource.name}</p>
        <p className="mt-0.5 truncate text-xs font-semibold text-slate-500">
          Dernier pointage : {formatClockInTime(resource.lastClockInAt)}
        </p>
      </div>
      <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${tone}`}>
        {formatResourceStatus(resource)}
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-white text-slate-400">
        <PresenceIcon className="h-6 w-6" />
      </div>
      <p className="mt-4 text-base font-black text-slate-950">Aucun chantier actif</p>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
        Aucun résultat ne correspond aux filtres sélectionnés.
      </p>
    </section>
  );
}

function PresencesLoadingState() {
  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3">
        <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
      </section>
      <section className="space-y-3">
        <div className="h-36 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-36 animate-pulse rounded-lg bg-slate-100" />
      </section>
    </div>
  );
}

function formatResourceStatus(resource: MobileManagementPresenceResource) {
  if (resource.status === 'PRESENT') {
    return resource.presentSince ? `Présent depuis ${formatDurationSince(resource.presentSince)}` : 'Présent';
  }

  if (resource.status === 'PAUSED') {
    return 'En pause';
  }

  return 'Absent';
}

function formatDurationSince(value: string) {
  const diffMs = Math.max(0, Date.now() - new Date(value).getTime());
  const totalMinutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h${minutes.toString().padStart(2, '0')}`;
  }

  return `${minutes}min`;
}

function formatClockInTime(value: string | null) {
  if (!value) {
    return 'Aucun';
  }

  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatSiteStatus(status: string) {
  if (status === 'ACTIVE') {
    return 'Actif';
  }

  if (status === 'ON_HOLD') {
    return 'En pause';
  }

  if (status === 'COMPLETED') {
    return 'Terminé';
  }

  return status.replaceAll('_', ' ').toLowerCase();
}

function baseIcon(className: string, children: ReactNode) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

function PresenceIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <path
        d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM16.5 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M3.5 19c.8-3.2 2.4-5 4.5-5s3.7 1.8 4.5 5M13.5 17.5c.6-2.2 1.7-3.4 3-3.4 1.6 0 2.8 1.4 3.5 4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </>,
  );
}

function ChevronRightIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <path d="m9 5 7 7-7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />,
  );
}
