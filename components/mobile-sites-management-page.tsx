'use client';

import { SiteStatus } from '@prisma/client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type { MobileSitesManagementResponse, MobileSiteStatusFilter } from '@/types/mobile-sites';

type MobileSitesManagementPageProps = Readonly<{
  user: WebSessionUser;
}>;

const statusFilters: { id: MobileSiteStatusFilter; label: string }[] = [
  { id: 'ALL', label: 'Tous' },
  { id: SiteStatus.ACTIVE, label: 'Actifs' },
  { id: SiteStatus.ON_HOLD, label: 'En pause' },
  { id: SiteStatus.COMPLETED, label: 'Terminés' },
];

export function MobileSitesManagementPage({ user }: MobileSitesManagementPageProps) {
  const [status, setStatus] = useState<MobileSiteStatusFilter>('ALL');
  const [projectId, setProjectId] = useState('ALL');
  const [query, setQuery] = useState('');

  const sitesQuery = useQuery({
    queryKey: ['mobile-sites-management', status, projectId, query],
    queryFn: async () => {
      const searchParams = new URLSearchParams();

      if (status !== 'ALL') {
        searchParams.set('status', status);
      }

      if (projectId !== 'ALL') {
        searchParams.set('projectId', projectId);
      }

      if (query.trim()) {
        searchParams.set('q', query.trim());
      }

      const response = await authFetch(`/api/mobile/sites/management?${searchParams.toString()}`);

      if (!response.ok) {
        throw new Error(`Sites management request failed with status ${response.status}`);
      }

      return (await response.json()) as MobileSitesManagementResponse;
    },
    staleTime: 30_000,
  });

  const data = sitesQuery.data;
  const selectedProjectName = useMemo(() => {
    if (!data || projectId === 'ALL') {
      return null;
    }

    return data.projects.find((project) => project.id === projectId)?.name ?? null;
  }, [data, projectId]);

  return (
    <div className="space-y-5 pb-20">
      <section className="rounded-lg border border-primary/20 bg-primary/10 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Gestion chantiers</p>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-black leading-7 text-slate-950">
              {user.role === 'PROJECT_MANAGER' ? 'Mes chantiers' : 'Tous les chantiers'}
            </h1>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              {selectedProjectName ?? 'Suivi des sites, équipes et pointages'}
            </p>
          </div>
          <Link
            className="flex min-h-12 shrink-0 items-center justify-center rounded-lg bg-primary px-3 text-sm font-black text-white shadow-panel"
            href={projectId === 'ALL' ? '/mobile/sites/new' : `/mobile/sites/new?projectId=${encodeURIComponent(projectId)}`}
          >
            Nouveau
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <MetricCard label="Chantiers" value={data?.widgets.total ?? 0} />
        <MetricCard label="Actifs" value={data?.widgets.active ?? 0} />
        <MetricCard label="En pause" value={data?.widgets.onHold ?? 0} />
        <MetricCard label="Terminés" value={data?.widgets.completed ?? 0} />
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-panel">
        <label className="block text-xs font-bold uppercase tracking-[0.16em] text-slate-500" htmlFor="site-search">
          Recherche
        </label>
        <input
          className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-primary"
          id="site-search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nom, adresse ou projet"
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
            onChange={(event) => setProjectId(event.target.value)}
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
      </section>

      {sitesQuery.isLoading ? <SitesLoadingState /> : null}

      {sitesQuery.isError ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          Impossible de charger les chantiers.
        </section>
      ) : null}

      {!sitesQuery.isLoading && data?.sites.length === 0 ? (
        <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
          <h2 className="text-lg font-black text-slate-950">Aucun chantier</h2>
          <p className="mt-2 text-sm font-semibold text-slate-500">
            Aucun chantier ne correspond aux filtres sélectionnés.
          </p>
        </section>
      ) : null}

      <section className="space-y-3">
        {data?.sites.map((site) => (
          <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel" key={site.id}>
            <Link className="block transition active:scale-[0.99]" href={`/mobile/sites/${encodeURIComponent(site.id)}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className={`rounded-full px-2 py-1 text-[11px] font-black ${siteStatusTone(site.status)}`}>
                    {formatSiteStatus(site.status)}
                  </span>
                  <h2 className="mt-3 truncate text-base font-black text-slate-950">{site.name}</h2>
                  <p className="mt-1 truncate text-sm font-bold text-slate-500">{site.project.name}</p>
                </div>
                <span className="text-lg font-black text-slate-300">›</span>
              </div>
              <p className="mt-3 line-clamp-2 text-sm font-semibold leading-5 text-slate-600">{site.address}</p>
              <p className="mt-2 text-xs font-bold text-slate-400">
                {site.latitude.toFixed(4)}, {site.longitude.toFixed(4)} · rayon {site.radiusKm} km
              </p>
            </Link>

            <div className="mt-4 grid grid-cols-4 gap-2">
              <SmallMetric label="Équipes" value={site.teamsCount} />
              <SmallMetric label="Ress." value={site.resourcesCount} />
              <SmallMetric label="Photos" value={site.photosCount} />
              <SmallMetric label="Pointages" value={site.clockInRecordsCount} />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link
                className="flex min-h-11 items-center justify-center rounded-lg bg-primary text-xs font-black text-white"
                href={`/mobile/sites/${encodeURIComponent(site.id)}`}
              >
                Voir détails
              </Link>
              <Link
                className="flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-xs font-black text-slate-700"
                href={`/mobile/sites/${encodeURIComponent(site.id)}/edit`}
              >
                Modifier
              </Link>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function MetricCard({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
      <p className="text-2xl font-black text-slate-950">{value}</p>
      <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
    </article>
  );
}

function SmallMetric({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="rounded-lg bg-slate-50 p-2 text-center">
      <p className="text-base font-black text-slate-950">{value}</p>
      <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">{label}</p>
    </div>
  );
}

function SitesLoadingState() {
  return (
    <section className="space-y-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div className="h-44 animate-pulse rounded-lg bg-slate-100" key={index} />
      ))}
    </section>
  );
}

function formatSiteStatus(status: SiteStatus) {
  switch (status) {
    case SiteStatus.ACTIVE:
      return 'Actif';
    case SiteStatus.ON_HOLD:
      return 'En pause';
    case SiteStatus.COMPLETED:
      return 'Terminé';
    default:
      return status;
  }
}

function siteStatusTone(status: SiteStatus) {
  switch (status) {
    case SiteStatus.ACTIVE:
      return 'bg-emerald-100 text-emerald-800';
    case SiteStatus.ON_HOLD:
      return 'bg-amber-100 text-amber-800';
    case SiteStatus.COMPLETED:
      return 'bg-slate-100 text-slate-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}
