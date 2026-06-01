'use client';

import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Role } from '@prisma/client';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { authFetch } from '@/lib/auth/client-session';
import { formatRoleLabel } from '@/lib/role-labels';
import type {
  RhSitePresenceLiveResource,
  RhSitePresenceLiveResponse,
  RhSitePresenceLiveStatus,
} from '@/types/rh';

type RhSitePresencesLivePageProps = Readonly<{
  viewer: {
    role: Role;
  };
}>;

type LiveResourceListItem = RhSitePresenceLiveResource & {
  siteId: string;
  siteName: string;
  siteAddress: string;
  projectName: string;
};

const inputClassName =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white';

const liveStatuses: RhSitePresenceLiveStatus[] = ['PRESENT', 'PAUSED', 'EXPECTED_NOT_CLOCKED', 'LEFT', 'ANOMALY'];

export function RhSitePresencesLivePage({ viewer }: RhSitePresencesLivePageProps) {
  const [projectId, setProjectId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [anomaliesOnly, setAnomaliesOnly] = useState(false);

  const requestPath = useMemo(() => {
    const searchParams = new URLSearchParams();
    if (projectId) searchParams.set('projectId', projectId);
    if (siteId) searchParams.set('siteId', siteId);
    if (resourceId) searchParams.set('resourceId', resourceId);
    if (role) searchParams.set('role', role);
    if (status) searchParams.set('status', status);
    if (search.trim()) searchParams.set('q', search.trim());
    if (anomaliesOnly) searchParams.set('anomaliesOnly', 'true');

    const queryString = searchParams.toString();
    return queryString ? `/api/rh/site-presences-live?${queryString}` : '/api/rh/site-presences-live';
  }, [anomaliesOnly, projectId, resourceId, role, search, siteId, status]);

  const liveQuery = useQuery({
    queryKey: ['rh-site-presences-live', requestPath],
    queryFn: async () => {
      const response = await authFetch(requestPath, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`RH site presences live failed with status ${response.status}`);
      }

      return (await response.json()) as RhSitePresenceLiveResponse;
    },
    refetchInterval: 45_000,
    staleTime: 20_000,
  });

  const data = liveQuery.data;
  const filteredSites = useMemo(() => data?.sites ?? [], [data?.sites]);
  const resources = useMemo(
    () =>
      filteredSites
        .flatMap((site) =>
          site.resources.map((resource) => ({
            ...resource,
            siteId: site.siteId,
            siteName: site.siteName,
            siteAddress: site.siteAddress,
            projectName: site.projectName,
          })),
        )
        .sort(compareLivePresenceResource),
    [filteredSites],
  );

  if (liveQuery.isLoading && !data) {
    return <LoadingState />;
  }

  if (liveQuery.isError) {
    return (
      <EmptyState
        description="Les présences chantier live ne peuvent pas être chargées pour le moment."
        title="Suivi live indisponible"
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
              Présences chantiers
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              Suivi live tous projets
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Vue instantanée des ressources attendues, présentes, sorties, en pause ou en anomalie sur les chantiers.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-slate-100 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
              {data ? `MAJ ${formatTime(data.generatedAt)}` : 'Chargement'}
            </span>
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              onClick={() => void liveQuery.refetch()}
              type="button"
            >
              Actualiser
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 [&>*:nth-child(3)]:hidden">
        <LiveKpi label="Présentes maintenant" tone="success" value={data?.summary.presentResources ?? 0} />
        <LiveKpi label="Attendues terrain" value={data?.summary.expectedResources ?? 0} />
        <LiveKpi label="Présentes" tone="success" value={data?.summary.presentResources ?? 0} />
        <LiveKpi label="Non pointées" tone="warning" value={data?.summary.notClockedResources ?? 0} />
        <LiveKpi label="Anomalies" tone={(data?.summary.anomalies ?? 0) > 0 ? 'danger' : 'neutral'} value={data?.summary.anomalies ?? 0} />
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="mb-5 flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-slate-950">Filtres live</h2>
          <p className="text-sm text-slate-500">Affinez par projet, chantier, ressource, rôle ou statut.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Projet">
            <select className={inputClassName} onChange={(event) => setProjectId(event.target.value)} value={projectId}>
              <option value="">Tous les projets</option>
              {(data?.options.projects ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Chantier">
            <select className={inputClassName} onChange={(event) => setSiteId(event.target.value)} value={siteId}>
              <option value="">Tous les chantiers</option>
              {(data?.options.sites ?? []).map((site) => (
                <option key={site.id} value={site.id}>
                  {site.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ressource">
            <select className={inputClassName} onChange={(event) => setResourceId(event.target.value)} value={resourceId}>
              <option value="">Toutes les ressources</option>
              {(data?.options.resources ?? []).map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.label} - {formatRoleLabel(resource.role as Role)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rôle">
            <select className={inputClassName} onChange={(event) => setRole(event.target.value)} value={role}>
              <option value="">Tous les rôles</option>
              {(data?.options.roles ?? []).map((roleOption) => (
                <option key={roleOption} value={roleOption}>
                  {formatRoleLabel(roleOption as Role)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Statut">
            <select className={inputClassName} onChange={(event) => setStatus(event.target.value)} value={status}>
              <option value="">Tous les statuts</option>
              {liveStatuses.map((item) => (
                <option key={item} value={item}>
                  {liveStatusLabel(item)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Recherche">
            <input
              className={inputClassName}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Projet, chantier, ressource, tâche..."
              type="search"
              value={search}
            />
          </Field>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              checked={anomaliesOnly}
              className="h-4 w-4 rounded border-slate-300 text-orange-600"
              onChange={(event) => setAnomaliesOnly(event.target.checked)}
              type="checkbox"
            />
            Afficher uniquement les anomalies
          </label>
          <Badge tone="neutral">{formatRoleLabel(viewer.role)}</Badge>
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-600">Liste de présence</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-950">Ressources terrain aujourd&apos;hui</h2>
            <p className="mt-1 text-sm text-slate-500">
              {resources.length} ressource(s) affichée(s), mise à jour {data ? formatTime(data.generatedAt) : '--:--'}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SiteCounter label="Présents" tone="success" value={data?.summary.presentResources ?? 0} />
            <SiteCounter label="Pause" tone="warning" value={data?.summary.pausedResources ?? 0} />
            <SiteCounter label="Sorties" value={filteredSites.reduce((sum, site) => sum + site.leftCount, 0)} />
          </div>
        </div>

        {resources.length === 0 ? (
          <EmptyState
            description="Aucune ressource ne correspond aux filtres actifs."
            title="Aucune présence chantier"
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {resources.map((resource) => (
              <ResourcePresenceItem key={`${resource.siteId}:${resource.userId}`} resource={resource} />
            ))}
          </div>
        )}
      </section>

      <section className="hidden">
        {filteredSites.length === 0 ? (
          <EmptyState
            description="Aucun chantier ne correspond aux filtres actifs."
            title="Aucune présence chantier"
          />
        ) : (
          filteredSites.map((site) => (
            <article className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-panel" key={site.siteId}>
              <div className="border-b border-slate-100 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-600">{site.projectName}</p>
                    <h2 className="mt-2 text-xl font-semibold text-slate-950">{site.siteName}</h2>
                    <p className="mt-1 text-sm text-slate-500">{site.siteAddress}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <SiteCounter label="Présents" tone="success" value={site.presentCount} />
                    <SiteCounter label="Attendues" value={site.expectedCount} />
                    <SiteCounter label="Non pointées" tone="warning" value={site.notClockedCount} />
                    {site.anomalyCount > 0 ? <SiteCounter label="Anomalies" tone="danger" value={site.anomalyCount} /> : null}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <span className="text-xs font-semibold text-slate-500">
                    Dernière activité : {site.lastActivityAt ? formatDateTime(site.lastActivityAt) : "Aucune aujourd'hui"}
                  </span>
                  <Link
                    className="text-xs font-bold text-orange-700 underline-offset-4 hover:underline"
                    href={`/web/sites/${encodeURIComponent(site.siteId)}/presences`}
                  >
                    Ouvrir le détail chantier
                  </Link>
                </div>
              </div>

              {site.resources.length === 0 ? (
                <div className="p-5 text-sm font-semibold text-slate-500">Aucune ressource attendue ou pointée aujourd&apos;hui.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-5 py-3 font-semibold">Ressource</th>
                        <th className="px-5 py-3 font-semibold">Statut</th>
                        <th className="px-5 py-3 font-semibold">Tâche</th>
                        <th className="px-5 py-3 font-semibold">Entrée</th>
                        <th className="px-5 py-3 font-semibold">Dernier pointage</th>
                        <th className="px-5 py-3 font-semibold">Distance</th>
                        <th className="px-5 py-3 font-semibold">Flags</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {site.resources.map((resource) => (
                        <ResourceRow key={`${site.siteId}:${resource.userId}`} resource={resource} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          ))
        )}
      </section>
    </div>
  );
}

function ResourceRow({ resource }: Readonly<{ resource: RhSitePresenceLiveResource }>) {
  return (
    <tr className="align-top hover:bg-slate-50">
      <td className="px-5 py-4">
        <p className="font-semibold text-slate-950">{resource.name}</p>
        <p className="mt-1 text-xs text-slate-500">{resource.email}</p>
        <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
          {formatRoleLabel(resource.role as Role)}
        </p>
      </td>
      <td className="px-5 py-4">
        <Badge tone={liveStatusTone(resource.status)}>{liveStatusLabel(resource.status)}</Badge>
      </td>
      <td className="max-w-xs px-5 py-4 text-slate-600">{resource.taskAction ?? 'Aucune tâche terrain'}</td>
      <td className="px-5 py-4 text-slate-600">{resource.arrivalAt ? formatTime(resource.arrivalAt) : '-'}</td>
      <td className="px-5 py-4 text-slate-600">
        {resource.lastClockInAt ? `${formatTime(resource.lastClockInAt)} (${clockInTypeLabel(resource.lastClockInType)})` : '-'}
      </td>
      <td className="px-5 py-4 text-slate-600">{resource.distanceKm === null ? '-' : `${resource.distanceKm.toFixed(2)} km`}</td>
      <td className="px-5 py-4">
        <div className="flex flex-wrap gap-1.5">
          {resource.isRemoteCheckout ? <SmallFlag label="Sortie distance" tone="warning" /> : null}
          {resource.isAutoClosed ? <SmallFlag label="Auto" tone="danger" /> : null}
          {resource.isRegularized ? <SmallFlag label="Régularisé" tone="info" /> : null}
          {!resource.isRemoteCheckout && !resource.isAutoClosed && !resource.isRegularized ? <span className="text-slate-400">-</span> : null}
        </div>
      </td>
    </tr>
  );
}

function ResourcePresenceItem({ resource }: Readonly<{ resource: LiveResourceListItem }>) {
  const flags = [
    resource.isRemoteCheckout ? 'Sortie à distance' : null,
    resource.isAutoClosed ? 'Auto-clôturée' : null,
    resource.isRegularized ? 'Régularisée' : null,
  ].filter(Boolean);

  return (
    <article className="py-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_auto_minmax(150px,0.5fr)_auto] lg:items-center">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-slate-950">{resource.name}</p>
          <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
            {formatRoleLabel(resource.role as Role)}
            {resource.email ? ` · ${resource.email}` : ''}
          </p>
        </div>
        <Badge tone={liveStatusTone(resource.status)}>{liveStatusLabel(resource.status)}</Badge>
        <div className="text-sm font-semibold text-slate-700">
          <p>Entrée : {resource.arrivalAt ? formatTime(resource.arrivalAt) : '-'}</p>
          <p className="mt-1 text-xs text-slate-500">
            Dernier : {resource.lastClockInAt ? `${formatTime(resource.lastClockInAt)} ${clockInTypeLabel(resource.lastClockInType)}` : '-'}
          </p>
        </div>
        <Link
          className="w-fit rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-orange-100 hover:text-orange-700"
          href={`/web/sites/${encodeURIComponent(resource.siteId)}/presences`}
        >
          Détail
        </Link>
      </div>

      <details className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <summary className="cursor-pointer font-bold text-slate-700">Projet, chantier et tâche</summary>
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          <p><span className="font-semibold text-slate-950">Projet :</span> {resource.projectName}</p>
          <p><span className="font-semibold text-slate-950">Chantier :</span> {resource.siteName}</p>
          <p><span className="font-semibold text-slate-950">Adresse :</span> {resource.siteAddress}</p>
          <p>
            <span className="font-semibold text-slate-950">Distance :</span>{' '}
            {resource.distanceKm === null ? '-' : `${resource.distanceKm.toFixed(2)} km`}
          </p>
          <p className="lg:col-span-2">
            <span className="font-semibold text-slate-950">Tâche :</span> {resource.taskAction ?? 'Aucune tâche terrain'}
          </p>
          {flags.length > 0 ? (
            <p className="lg:col-span-2"><span className="font-semibold text-slate-950">Flags :</span> {flags.join(', ')}</p>
          ) : null}
        </div>
      </details>
    </article>
  );
}

function LiveKpi({
  label,
  value,
  tone = 'neutral',
}: Readonly<{
  label: string;
  value: number;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}>) {
  const toneClassName = {
    neutral: 'border-slate-200 bg-white text-slate-950',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    warning: 'border-orange-200 bg-orange-50 text-orange-950',
    danger: 'border-red-200 bg-red-50 text-red-950',
  }[tone];

  return (
    <article className={`rounded-[2rem] border p-5 shadow-panel ${toneClassName}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-70">{label}</p>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
    </article>
  );
}

function Field({ children, label }: Readonly<{ children: ReactNode; label: string }>) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function SiteCounter({
  label,
  value,
  tone = 'neutral',
}: Readonly<{
  label: string;
  value: number;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}>) {
  const className = {
    neutral: 'bg-slate-100 text-slate-700',
    success: 'bg-emerald-100 text-emerald-700',
    warning: 'bg-orange-100 text-orange-700',
    danger: 'bg-red-100 text-red-700',
  }[tone];

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold ${className}`}>
      {label}: {value}
    </span>
  );
}

function SmallFlag({ label, tone }: Readonly<{ label: string; tone: 'info' | 'warning' | 'danger' }>) {
  const className = {
    info: 'bg-blue-100 text-blue-700',
    warning: 'bg-orange-100 text-orange-700',
    danger: 'bg-red-100 text-red-700',
  }[tone];

  return <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${className}`}>{label}</span>;
}

function liveStatusLabel(status: RhSitePresenceLiveStatus) {
  const labels: Record<RhSitePresenceLiveStatus, string> = {
    PRESENT: 'Présent',
    PAUSED: 'En pause',
    EXPECTED_NOT_CLOCKED: 'Non pointé',
    LEFT: 'Sortie enregistrée',
    ANOMALY: 'Anomalie',
  };

  return labels[status];
}

function liveStatusTone(status: RhSitePresenceLiveStatus) {
  if (status === 'PRESENT') return 'success';
  if (status === 'PAUSED') return 'warning';
  if (status === 'ANOMALY') return 'error';
  return 'neutral';
}

function compareLivePresenceResource(left: LiveResourceListItem, right: LiveResourceListItem) {
  const statusDiff = liveStatusSortRank(left.status) - liveStatusSortRank(right.status);
  if (statusDiff !== 0) return statusDiff;
  return left.name.localeCompare(right.name);
}

function liveStatusSortRank(status: RhSitePresenceLiveStatus) {
  const ranks: Record<RhSitePresenceLiveStatus, number> = {
    PRESENT: 0,
    PAUSED: 1,
    ANOMALY: 2,
    EXPECTED_NOT_CLOCKED: 3,
    LEFT: 4,
  };
  return ranks[status];
}

function clockInTypeLabel(type: string | null) {
  if (type === 'ARRIVAL') return 'Entrée';
  if (type === 'DEPARTURE') return 'Sortie';
  if (type === 'PAUSE_START') return 'Pause';
  if (type === 'PAUSE_END') return 'Reprise';
  return 'Pointage';
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <section className="h-40 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
        ))}
      </section>
      <section className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
    </div>
  );
}
