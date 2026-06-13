'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Role } from '@prisma/client';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { SearchableSelect, type SearchableSelectOption } from '@/components/searchable-select';
import { authFetch } from '@/lib/auth/client-session';
import { formatRoleLabel } from '@/lib/role-labels';
import { useToast } from '@/components/toast-provider';
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
  siteId: string | null;
  siteName: string;
  siteAddress: string;
  projectName: string;
};

type LiveResourceContext = LiveResourceListItem;

type AggregatedLiveResource = RhSitePresenceLiveResource & {
  contexts: LiveResourceContext[];
};

const inputClassName =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white';

const liveStatuses: RhSitePresenceLiveStatus[] = ['PRESENT', 'PAUSED', 'EXPECTED_NOT_CLOCKED', 'LEFT', 'ANOMALY'];

export function RhSitePresencesLivePage({ viewer }: RhSitePresencesLivePageProps) {
  const { pushToast } = useToast();
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [context, setContext] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projectManagerId, setProjectManagerId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [assignedById, setAssignedById] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [anomaliesOnly, setAnomaliesOnly] = useState(false);
  const [lateOnly, setLateOnly] = useState(false);
  const canExportPresenceList = viewer.role === 'HR' || viewer.role === 'DIRECTION' || viewer.role === 'ADMIN';

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [search]);

  const requestPath = useMemo(() => {
    const searchParams = new URLSearchParams();
    if (selectedDate) searchParams.set('date', selectedDate);
    if (context) searchParams.set('context', context);
    if (projectId) searchParams.set('projectId', projectId);
    if (projectManagerId) searchParams.set('projectManagerId', projectManagerId);
    if (siteId) searchParams.set('siteId', siteId);
    if (resourceId) searchParams.set('resourceId', resourceId);
    if (assignedById) searchParams.set('assignedById', assignedById);
    if (role) searchParams.set('role', role);
    if (status) searchParams.set('status', status);
    if (lateOnly) searchParams.set('lateOnly', 'true');
    if (debouncedSearch) searchParams.set('q', debouncedSearch);
    if (anomaliesOnly) searchParams.set('anomaliesOnly', 'true');

    const queryString = searchParams.toString();
    return queryString ? `/api/rh/site-presences-live?${queryString}` : '/api/rh/site-presences-live';
  }, [anomaliesOnly, assignedById, context, debouncedSearch, lateOnly, projectId, projectManagerId, resourceId, role, selectedDate, siteId, status]);

  const liveQuery = useQuery({
    queryKey: ['rh-site-presences-live', requestPath],
    queryFn: async () => {
      const response = await authFetch(requestPath, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`RH site presences live failed with status ${response.status}`);
      }

      return (await response.json()) as RhSitePresenceLiveResponse;
    },
    refetchInterval: selectedDate === new Date().toISOString().slice(0, 10) ? 45_000 : false,
    staleTime: 20_000,
    placeholderData: (previousData) => previousData,
  });
  const exportMutation = useMutation({
    mutationFn: async (format: 'xlsx' | 'pdf') => {
      const response = await authFetch('/api/rh/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          format,
          from: `${selectedDate}T00:00:00.000Z`,
          to: `${selectedDate}T23:59:59.999Z`,
          userId: resourceId || null,
          projectId: projectId || null,
          siteIds: siteId ? [siteId] : [],
          context: context || null,
          lateOnly,
          attendanceList: true,
        }),
      });

      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Export de presence impossible.');
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition');
      const match = contentDisposition?.match(/filename="([^"]+)"/);
      return {
        blob,
        fileName: match?.[1] ?? `liste-presence-${selectedDate}.${format}`,
      };
    },
    onSuccess: ({ blob, fileName }) => {
      triggerDownload(blob, fileName);
      pushToast({ type: 'success', title: 'Liste telechargee' });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Telechargement impossible',
        message: error instanceof Error ? error.message : 'La liste de presence na pas pu etre generee.',
      });
    },
  });
  const closeForgottenSessionMutation = useMutation({
    mutationFn: async (arrivalRecordId: string) => {
      const response = await authFetch('/api/rh/presences/close-forgotten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arrivalRecordId }),
      });
      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Fermeture de session impossible.');
      }
      return response.json() as Promise<{ recordId: string }>;
    },
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Sortie fermee par administrateur' });
      await liveQuery.refetch();
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Fermeture impossible',
        message: error instanceof Error ? error.message : 'La session oubliee na pas pu etre fermee.',
      });
    },
  });

  const data = liveQuery.data;
  const filteredSites = useMemo(() => data?.sites ?? [], [data?.sites]);
  const projectOptions = useMemo(
    () => (data?.options.projects ?? []).map((project) => ({ value: project.id, label: project.label })),
    [data?.options.projects],
  );
  const siteOptions = useMemo(
    () => (data?.options.sites ?? []).map((site) => ({ value: site.id, label: site.label })),
    [data?.options.sites],
  );
  const resourceOptions = useMemo(
    () => toPresenceResourceOptions(data?.options.resources ?? []),
    [data?.options.resources],
  );
  const projectManagerOptions = useMemo(
    () => (data?.options.projectManagers ?? []).map((manager) => ({ value: manager.id, label: manager.label })),
    [data?.options.projectManagers],
  );
  const assignerOptions = useMemo(
    () => (data?.options.assigners ?? []).map((assigner) => ({ value: assigner.id, label: assigner.label })),
    [data?.options.assigners],
  );
  const resources = useMemo(() => aggregateLiveResources(flattenLiveResources(filteredSites)), [filteredSites]);
  const displaySummary = useMemo(() => buildDisplaySummary(resources), [resources]);

  if (liveQuery.isLoading && !data) {
    return <LoadingState />;
  }

  if (liveQuery.isError) {
    return (
      <EmptyState
        description="Les presences chantier live ne peuvent pas etre chargees pour le moment."
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
              Presences
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              Liste de presence
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Ressources attendues sur terrain ou deja pointees au bureau ou sur terrain a la date selectionnee.
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
            {canExportPresenceList ? (
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                  disabled={exportMutation.isPending}
                  onClick={() => exportMutation.mutate('xlsx')}
                  type="button"
                >
                  {exportMutation.isPending ? 'Generation...' : 'Telecharger XLSX'}
                </button>
                <button
                  className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                  disabled={exportMutation.isPending}
                  onClick={() => exportMutation.mutate('pdf')}
                  type="button"
                >
                  PDF
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <LiveKpi label="Presentes" tone="success" value={displaySummary.present} />
        <LiveKpi label="Attendues" value={displaySummary.expected} />
        <LiveKpi label="Absentes" tone="warning" value={displaySummary.absent} />
        <LiveKpi label="Retards" tone={displaySummary.late > 0 ? 'warning' : 'neutral'} value={displaySummary.late} />
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="mb-5 flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-slate-950">Filtres</h2>
          <p className="text-sm text-slate-500">Affinez la liste sans ouvrir les details projets ou chantiers.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Date">
            <input
              className={inputClassName}
              onChange={(event) => setSelectedDate(event.target.value)}
              type="date"
              value={selectedDate}
            />
          </Field>
          <Field label="Contexte">
            <select className={inputClassName} onChange={(event) => setContext(event.target.value)} value={context}>
              <option value="">Terrain et bureau</option>
              <option value="TERRAIN">Terrain</option>
              <option value="OFFICE">Bureau</option>
            </select>
          </Field>
          <Field label="Projet">
            <SearchableSelect
              onChange={(value) => {
                setProjectId(value);
                setSiteId('');
              }}
              options={projectOptions}
              placeholder="Tous les projets"
              value={projectId}
            />
          </Field>
          <Field label="Chef projet">
            <SearchableSelect
              onChange={(value) => {
                setProjectManagerId(value);
                setProjectId('');
                setSiteId('');
              }}
              options={projectManagerOptions}
              placeholder="Tous les chefs projets"
              value={projectManagerId}
            />
          </Field>
          <Field label="Chantier">
            <SearchableSelect
              onChange={setSiteId}
              options={siteOptions}
              placeholder="Tous les chantiers"
              value={siteId}
            />
          </Field>
          <Field label="Ressource">
            <SearchableSelect
              onChange={setResourceId}
              options={resourceOptions}
              placeholder="Toutes les ressources"
              value={resourceId}
            />
          </Field>
          <Field label="Assignateur">
            <SearchableSelect
              onChange={setAssignedById}
              options={assignerOptions}
              placeholder="Tous les assignateurs"
              value={assignedById}
            />
          </Field>
          <Field label="Role">
            <select className={inputClassName} onChange={(event) => setRole(event.target.value)} value={role}>
              <option value="">Tous les roles</option>
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
              placeholder="Projet, chantier, ressource, tache..."
              type="search"
              value={search}
            />
          </Field>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                checked={anomaliesOnly}
                className="h-4 w-4 rounded border-slate-300 text-orange-600"
                onChange={(event) => setAnomaliesOnly(event.target.checked)}
                type="checkbox"
              />
              Afficher uniquement les anomalies
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                checked={lateOnly}
                className="h-4 w-4 rounded border-slate-300 text-orange-600"
                onChange={(event) => setLateOnly(event.target.checked)}
                type="checkbox"
              />
              Retards uniquement
            </label>
          </div>
          <Badge tone="neutral">{formatRoleLabel(viewer.role)}</Badge>
        </div>
        {liveQuery.isFetching ? (
          <p className="mt-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Mise a jour de la liste...</p>
        ) : null}
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-600">Liste de presence</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-950">Ressources du jour</h2>
            <p className="mt-1 text-sm text-slate-500">
              {resources.length} ressource(s) affichee(s), mise a jour {data ? formatTime(data.generatedAt) : '--:--'}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SiteCounter label="Presents" tone="success" value={displaySummary.present} />
            <SiteCounter label="Pause" tone="warning" value={displaySummary.paused} />
            <SiteCounter label="Absents" tone="warning" value={displaySummary.absent} />
            <SiteCounter label="Sorties" value={displaySummary.left} />
            <SiteCounter label="Retards" tone="warning" value={displaySummary.late} />
          </div>
        </div>

        {resources.length === 0 ? (
          <EmptyState
            description="Aucune ressource ne correspond aux filtres actifs."
            title="Aucune presence"
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {resources.map((resource) => (
              <ResourcePresenceItem
                canCloseForgottenSession={viewer.role === 'ADMIN'}
                closePending={closeForgottenSessionMutation.isPending}
                key={resource.userId}
                onCloseForgottenSession={(arrivalRecordId) => closeForgottenSessionMutation.mutate(arrivalRecordId)}
                resource={resource}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ResourcePresenceItem({
  canCloseForgottenSession,
  closePending,
  onCloseForgottenSession,
  resource,
}: Readonly<{
  canCloseForgottenSession: boolean;
  closePending: boolean;
  onCloseForgottenSession: (arrivalRecordId: string) => void;
  resource: AggregatedLiveResource;
}>) {
  const contextSummary = getResourceContextSummary(resource.contexts);
  const isUnplannedClockIn = resource.contexts.some(
    (context) =>
      context.presenceContext === 'TERRAIN' &&
      !context.taskAction &&
      context.status !== 'EXPECTED_NOT_CLOCKED',
  );
  const anomalyLabel = resource.anomalyReason ?? (resource.status === 'ANOMALY' ? 'Pointage a verifier' : null);
  const flags = [
    isUnplannedClockIn ? 'Non prevu' : null,
    anomalyLabel,
    !anomalyLabel && resource.isRemoteCheckout ? 'Sortie a distance' : null,
    !anomalyLabel && resource.isAutoClosed ? 'Auto-cloturee' : null,
    resource.isRegularized ? 'Regularisee' : null,
    resource.isLate ? 'Retard' : null,
  ].filter(Boolean);
  const statusLabel = getLiveResourceStatusLabel(resource);

  return (
    <article className="py-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_auto_minmax(160px,0.6fr)] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-base font-semibold text-slate-950">{resource.name}</p>
            {contextSummary ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">
                {contextSummary}
              </span>
            ) : null}
            {isUnplannedClockIn ? (
              <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-blue-700">
                Non prevu
              </span>
            ) : null}
            {resource.isLate ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-800">
                Retard
              </span>
            ) : null}
            {resource.anomalyReason ? (
              <span className="rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-red-700">
                {resource.anomalyReason}
              </span>
            ) : null}
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
              resource.presenceContext === 'OFFICE' ? 'bg-sky-100 text-sky-700' : 'bg-emerald-100 text-emerald-700'
            }`}>
              {presenceContextLabel(resource.presenceContext)}
            </span>
          </div>
          <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
            {formatRoleLabel(resource.role as Role)}
            
          </p>
        </div>
        <Badge tone={liveStatusTone(resource.status)}>{statusLabel}</Badge>
        <div className="text-sm font-semibold text-slate-700">
          <p>Entree : {resource.arrivalAt ? formatTime(resource.arrivalAt) : '-'}</p>
          <p className="mt-1 text-xs text-slate-500">
            Dernier : {resource.lastClockInAt ? `${formatTime(resource.lastClockInAt)} ${clockInTypeLabel(resource.lastClockInType)}` : '-'}
          </p>
        </div>
      </div>

      <details className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <summary className="cursor-pointer font-bold text-slate-700">Details de presence</summary>
        <div className="mt-3 space-y-3">
          {resource.contexts.map((context, index) => (
            <div className="rounded-2xl bg-white p-3" key={`${context.siteId ?? 'mission'}:${context.userId}:${index}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-slate-950">
                  {presenceContextLabel(context.presenceContext)} - {context.siteName}
                </p>
                <Badge tone={liveStatusTone(context.status)}>{getLiveResourceStatusLabel(context)}</Badge>
              </div>
              {context.isLate ? (
                <p className="mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-800">
                  Arrivee apres 08:30
                </p>
              ) : null}
              {context.anomalyReason ? (
                <p className="mt-2 inline-flex rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-red-700">
                  {context.anomalyReason}
                </p>
              ) : null}
              {context.isRegularized && context.isRemoteCheckout && context.lastClockInType === 'DEPARTURE' ? (
                <p className="mt-2 inline-flex rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-sky-700">
                  Sortie fermee par administrateur
                </p>
              ) : null}
              <div className="mt-2 grid gap-2 lg:grid-cols-2">
                <p><span className="font-semibold text-slate-950">Projet :</span> {context.projectName || '-'}</p>
                <p><span className="font-semibold text-slate-950">Position :</span> {context.siteAddress}</p>
                <p><span className="font-semibold text-slate-950">Entree :</span> {context.arrivalAt ? formatTime(context.arrivalAt) : '-'}</p>
                <p><span className="font-semibold text-slate-950">Sortie :</span> {context.lastClockInType === 'DEPARTURE' && context.lastClockInAt ? formatTime(context.lastClockInAt) : '-'}</p>
                <p>
                  <span className="font-semibold text-slate-950">Distance :</span>{' '}
                  {context.distanceKm === null ? '-' : `${context.distanceKm.toFixed(2)} km`}
                </p>
                <p><span className="font-semibold text-slate-950">Tache :</span> {context.taskAction ?? (context.presenceContext === 'OFFICE' ? 'Pointage bureau' : 'Aucune tache terrain planifiee')}</p>
              </div>
              {context.arrivalGps || context.departureGps ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {context.arrivalGps ? (
                    <GpsPointLink label={`Position entree ${formatTime(context.arrivalGps.recordedAt)}`} point={context.arrivalGps} />
                  ) : null}
                  {context.departureGps ? (
                    <GpsPointLink label={`Position sortie ${formatTime(context.departureGps.recordedAt)}`} point={context.departureGps} />
                  ) : null}
                </div>
              ) : null}
              {canCloseForgottenSession && context.anomalyReason === 'Sortie oubliee' && context.arrivalRecordId ? (
                <button
                  className="mt-3 rounded-full border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={closePending}
                  onClick={() => onCloseForgottenSession(context.arrivalRecordId!)}
                  type="button"
                >
                  {closePending ? 'Fermeture...' : 'Fermer la sortie oubliée'}
                </button>
              ) : null}
            </div>
          ))}
          {flags.length > 0 ? (
            <p><span className="font-semibold text-slate-950">Indicateurs :</span> {flags.join(', ')}</p>
          ) : null}
        </div>
      </details>
    </article>
  );
}

function GpsPointLink({
  label,
  point,
}: Readonly<{
  label: string;
  point: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
  };
}>) {
  return (
    <a
      className="rounded-full bg-slate-950 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
      href={buildGpsMapUrl(point.latitude, point.longitude)}
      rel="noreferrer"
      target="_blank"
      title={point.accuracy === null ? undefined : `Precision GPS ${Math.round(point.accuracy)} m`}
    >
      {label}
    </a>
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

function liveStatusLabel(status: RhSitePresenceLiveStatus) {
  const labels: Record<RhSitePresenceLiveStatus, string> = {
    PRESENT: 'Present',
    PAUSED: 'En pause',
    EXPECTED_NOT_CLOCKED: 'Absent',
    LEFT: 'Sorti',
    ANOMALY: 'Anomalie',
  };

  return labels[status];
}

function getLiveResourceStatusLabel(resource: Pick<RhSitePresenceLiveResource, 'status' | 'anomalyReason'>) {
  if (resource.status !== 'ANOMALY') return liveStatusLabel(resource.status);
  return resource.anomalyReason ?? 'Pointage a verifier';
}

function liveStatusTone(status: RhSitePresenceLiveStatus) {
  if (status === 'PRESENT') return 'success';
  if (status === 'PAUSED' || status === 'EXPECTED_NOT_CLOCKED') return 'warning';
  if (status === 'ANOMALY') return 'error';
  return 'neutral';
}

function compareLivePresenceResource(left: AggregatedLiveResource, right: AggregatedLiveResource) {
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

function toPresenceResourceOptions(
  resources: { id: string; label: string; role: string }[],
): SearchableSelectOption[] {
  return resources.map((resource) => ({
    value: resource.id,
    label: resource.label,
    description: formatRoleLabel(resource.role as Role),
  }));
}

function flattenLiveResources(sites: RhSitePresenceLiveResponse['sites']): LiveResourceContext[] {
  return sites.flatMap((site) =>
    site.resources.map((resource) => ({
      ...resource,
      siteId: site.siteId,
      siteName: site.siteName,
      siteAddress: site.siteAddress,
      projectName: site.projectName,
    })),
  );
}

function aggregateLiveResources(contexts: LiveResourceContext[]): AggregatedLiveResource[] {
  const groupedResources = new Map<string, LiveResourceContext[]>();

  contexts.forEach((context) => {
    const existingContexts = groupedResources.get(context.userId) ?? [];
    existingContexts.push(context);
    groupedResources.set(context.userId, existingContexts);
  });

  return Array.from(groupedResources.values())
    .map((resourceContexts) => buildAggregatedLiveResource(resourceContexts))
    .sort(compareLivePresenceResource);
}

function buildAggregatedLiveResource(contexts: LiveResourceContext[]): AggregatedLiveResource {
  const sortedContexts = [...contexts].sort(compareLivePresenceContext);
  const status = getAggregateLiveStatus(sortedContexts);
  const primaryContext = pickPrimaryContext(sortedContexts, status);
  const latestClockIn = getLatestClockIn(sortedContexts);
  const displayArrival = getDisplayArrival(sortedContexts, status);

  return {
    ...primaryContext,
    status,
    taskAction: primaryContext.taskAction,
    arrivalAt: displayArrival ?? primaryContext.arrivalAt,
    lastClockInAt: latestClockIn?.lastClockInAt ?? primaryContext.lastClockInAt,
    lastClockInType: latestClockIn?.lastClockInType ?? primaryContext.lastClockInType,
    isRemoteCheckout: sortedContexts.some((context) => context.isRemoteCheckout),
    isAutoClosed: sortedContexts.some((context) => context.isAutoClosed),
    isRegularized: sortedContexts.some((context) => context.isRegularized),
    anomalyReason: sortedContexts.find((context) => context.anomalyReason)?.anomalyReason ?? null,
    isLate: sortedContexts.some((context) => !isForgottenExitContext(context) && context.isLate),
    contexts: sortedContexts,
  };
}

function compareLivePresenceContext(left: LiveResourceContext, right: LiveResourceContext) {
  const statusDiff = liveStatusSortRank(left.status) - liveStatusSortRank(right.status);
  if (statusDiff !== 0) return statusDiff;
  return left.siteName.localeCompare(right.siteName);
}

function getAggregateLiveStatus(contexts: LiveResourceContext[]): RhSitePresenceLiveStatus {
  if (contexts.some((context) => context.status === 'ANOMALY')) return 'ANOMALY';
  if (contexts.some((context) => context.status === 'PAUSED')) return 'PAUSED';
  if (contexts.some((context) => context.status === 'PRESENT')) return 'PRESENT';
  if (contexts.some((context) => context.status === 'EXPECTED_NOT_CLOCKED')) return 'EXPECTED_NOT_CLOCKED';
  if (contexts.some((context) => context.status === 'LEFT')) return 'LEFT';
  return 'EXPECTED_NOT_CLOCKED';
}

function pickPrimaryContext(
  contexts: LiveResourceContext[],
  status: RhSitePresenceLiveStatus,
): LiveResourceContext {
  return contexts.find((context) => context.status === status) ?? contexts[0]!;
}

function getLatestClockIn(contexts: LiveResourceContext[]) {
  return contexts
    .filter((context) => context.lastClockInAt)
    .sort((left, right) => new Date(right.lastClockInAt ?? 0).getTime() - new Date(left.lastClockInAt ?? 0).getTime())[0];
}

function getDisplayArrival(contexts: LiveResourceContext[], status: RhSitePresenceLiveStatus) {
  const nonForgottenContexts = contexts.filter((context) => !isForgottenExitContext(context));
  const statusContexts = nonForgottenContexts.filter((context) => context.status === status);

  if (statusContexts.length > 0) {
    return getFirstArrival(statusContexts);
  }

  if (status === 'EXPECTED_NOT_CLOCKED') {
    return null;
  }

  return getFirstArrival(nonForgottenContexts) ?? getFirstArrival(contexts);
}

function getFirstArrival(contexts: LiveResourceContext[]) {
  const arrival = contexts
    .map((context) => context.arrivalAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime())[0];

  return arrival ?? null;
}

function isForgottenExitContext(context: Pick<LiveResourceContext, 'anomalyReason'>) {
  return context.anomalyReason === 'Sortie oubliee';
}

function getResourceContextSummary(contexts: LiveResourceContext[]) {
  const terrainContexts = contexts.filter((context) => context.presenceContext === 'TERRAIN');
  const officeContexts = contexts.filter((context) => context.presenceContext === 'OFFICE');
  const uniqueTerrainSites = new Set(terrainContexts.map((context) => context.siteId ?? context.siteName));

  if (terrainContexts.length > 0 && officeContexts.length > 0) {
    return 'Mixte';
  }

  if (uniqueTerrainSites.size > 1) {
    return `${uniqueTerrainSites.size} chantiers`;
  }

  return null;
}

function buildDisplaySummary(resources: AggregatedLiveResource[]) {
  return resources.reduce(
    (summary, resource) => {
      if (resource.contexts.some(isExpectedContext)) summary.expected += 1;
      if (resource.status === 'PRESENT') summary.present += 1;
      if (resource.status === 'PAUSED') summary.paused += 1;
      if (resource.status === 'EXPECTED_NOT_CLOCKED') summary.absent += 1;
      if (resource.status === 'LEFT') summary.left += 1;
      if (resource.status === 'ANOMALY') summary.anomaly += 1;
      if (resource.isLate) summary.late += 1;
      return summary;
    },
    {
      expected: 0,
      present: 0,
      paused: 0,
      absent: 0,
      left: 0,
      anomaly: 0,
      late: 0,
    },
  );
}

function isExpectedContext(context: LiveResourceContext) {
  return Boolean(context.taskAction) || context.status === 'EXPECTED_NOT_CLOCKED';
}

function presenceContextLabel(context: 'TERRAIN' | 'OFFICE') {
  return context === 'OFFICE' ? 'Bureau' : 'Terrain';
}

function clockInTypeLabel(type: string | null) {
  if (type === 'ARRIVAL') return 'Entree';
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

function buildGpsMapUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function safeJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function LoadingState() {
  return (
    <div className="space-y-6">
      <section className="h-40 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
        ))}
      </section>
      <section className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
    </div>
  );
}
