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
  RhDirectionAttendanceReportResponse,
  RhDirectionAttendanceUser,
  RhPresenceCommentItem,
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

type AggregatedLiveResource = LiveResourceListItem & {
  contexts: LiveResourceContext[];
};

const inputClassName =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white';

const liveStatuses: RhSitePresenceLiveStatus[] = ['PRESENT', 'PAUSED', 'EXPECTED_NOT_CLOCKED', 'LEFT', 'ANOMALY'];

type PresenceSortMode = 'name' | 'arrival-asc' | 'arrival-desc';

type PresenceQuickFilter = 'all' | 'present' | 'paused' | 'absent' | 'left' | 'late' | 'out-of-planning' | 'anomaly';

type DirectionReportTab = 'not-clocked-today' | 'never-clocked' | 'clocked-today' | 'departure-only';

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
  const [arrivalFrom, setArrivalFrom] = useState('');
  const [arrivalTo, setArrivalTo] = useState('');
  const [sortMode, setSortMode] = useState<PresenceSortMode>('name');
  const [quickFilter, setQuickFilter] = useState<PresenceQuickFilter>('all');
  const [directionReportTab, setDirectionReportTab] = useState<DirectionReportTab>('not-clocked-today');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [anomaliesOnly, setAnomaliesOnly] = useState(false);
  const [lateOnly, setLateOnly] = useState(false);
  const canExportPresenceList = viewer.role === 'HR' || viewer.role === 'DIRECTION' || viewer.role === 'ADMIN';
  const canViewDirectionReport = canExportPresenceList;

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
    if (arrivalFrom) searchParams.set('arrivalFrom', arrivalFrom);
    if (arrivalTo) searchParams.set('arrivalTo', arrivalTo);
    if (lateOnly) searchParams.set('lateOnly', 'true');
    if (debouncedSearch) searchParams.set('q', debouncedSearch);
    if (anomaliesOnly) searchParams.set('anomaliesOnly', 'true');

    const queryString = searchParams.toString();
    return queryString ? `/api/rh/site-presences-live?${queryString}` : '/api/rh/site-presences-live';
  }, [anomaliesOnly, arrivalFrom, arrivalTo, assignedById, context, debouncedSearch, lateOnly, projectId, projectManagerId, resourceId, role, selectedDate, siteId, status]);

  const directionReportQuery = useQuery({
    queryKey: ['rh-direction-attendance-report', selectedDate],
    queryFn: async () => {
      const response = await authFetch(`/api/rh/direction-attendance-report?date=${encodeURIComponent(selectedDate)}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Direction attendance report failed with status ${response.status}`);
      }

      return (await response.json()) as RhDirectionAttendanceReportResponse;
    },
    enabled: canViewDirectionReport,
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
  });

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
  const resources = useMemo(
    () => sortAggregatedLiveResources(aggregateLiveResources(flattenLiveResources(filteredSites)), sortMode),
    [filteredSites, sortMode],
  );
  const quickFilterCounts = useMemo(() => buildQuickFilterCounts(resources), [resources]);
  const displayedResources = useMemo(
    () => resources.filter((resource) => matchesQuickFilter(resource, quickFilter)),
    [quickFilter, resources],
  );
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
        <LiveKpi label="Assignes" value={displaySummary.expected} />
        <LiveKpi label="Presents" tone="success" value={displaySummary.present} />
        <LiveKpi label="Presents terrain" tone="success" value={displaySummary.presentTerrain} />
        <LiveKpi label="Presents bureau" tone="neutral" value={displaySummary.presentOffice} />
        <LiveKpi label="Sortis" value={displaySummary.left} />
        <LiveKpi label="Absents" tone="danger" value={displaySummary.absent} />
        <LiveKpi label="Retards" tone={displaySummary.late > 0 ? 'warning' : 'neutral'} value={displaySummary.late} />
        <LiveKpi label="Anomalies" tone={displaySummary.anomaly > 0 ? 'danger' : 'neutral'} value={displaySummary.anomaly} />
      </section>

      {canViewDirectionReport ? (
        <DirectionAttendanceReportPanel
          activeTab={directionReportTab}
          data={directionReportQuery.data ?? null}
          isFetching={directionReportQuery.isFetching}
          isLoading={directionReportQuery.isLoading}
          onExportCsv={() => exportDirectionReportCsv(directionReportQuery.data)}
          onRefresh={() => void directionReportQuery.refetch()}
          onTabChange={setDirectionReportTab}
        />
      ) : null}

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
          <Field label="Arrivee de">
            <input
              className={inputClassName}
              onChange={(event) => setArrivalFrom(event.target.value)}
              type="time"
              value={arrivalFrom}
            />
          </Field>
          <Field label="Arrivee a">
            <input
              className={inputClassName}
              onChange={(event) => setArrivalTo(event.target.value)}
              type="time"
              value={arrivalTo}
            />
          </Field>
          <Field label="Tri">
            <select className={inputClassName} onChange={(event) => setSortMode(event.target.value as PresenceSortMode)} value={sortMode}>
              <option value="name">Alphabetique</option>
              <option value="arrival-asc">Arrivee : premier au dernier</option>
              <option value="arrival-desc">Arrivee : dernier au premier</option>
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
        <div className="mb-4">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-600">Liste de presence</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950">Ressources du jour</h2>
          <p className="mt-1 text-sm text-slate-500">
            {displayedResources.length} ressource(s) affichee(s) sur {resources.length}, mise a jour {data ? formatTime(data.generatedAt) : '--:--'}.
          </p>
        </div>

        <QuickFilterTabs
          activeFilter={quickFilter}
          counts={quickFilterCounts}
          onChange={setQuickFilter}
        />

        {displayedResources.length === 0 ? (
          <EmptyState
            description="Aucune ressource ne correspond aux filtres actifs."
            title="Aucune presence"
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {displayedResources.map((resource) => (
              <ResourcePresenceItem
                key={resource.userId}
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
  resource,
}: Readonly<{
  resource: AggregatedLiveResource;
}>) {
  const contextSummary = getResourceContextSummary(resource.contexts);
  const isOutOfPlanningClockIn = resource.contexts.some(isOutOfPlanningContext);
  const outOfPlanningStatus = getResourceOutOfPlanningStatus(resource.contexts);
  const flags = [
    isOutOfPlanningClockIn ? 'Hors planning' : null,
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
            {isOutOfPlanningClockIn ? (
              <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-blue-700">
                Hors planning
              </span>
            ) : null}
            {outOfPlanningStatus ? <OutOfPlanningValidationBadge status={outOfPlanningStatus} /> : null}
            {resource.isLate ? (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-800">
                Retard
              </span>
            ) : null}
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
              resource.presenceContext === 'OFFICE' ? 'bg-sky-100 text-sky-700' : 'bg-emerald-100 text-emerald-700'
            }`}>
              {presenceContextLabel(resource)}
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
                  {contextTitleLabel(context)}
                </p>
                <Badge tone={liveStatusTone(context.status)}>{getLiveResourceStatusLabel(context)}</Badge>
              </div>
              {context.outOfPlanningValidationStatus ? (
                <p className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${outOfPlanningValidationToneClass(context.outOfPlanningValidationStatus)}`}>
                  {outOfPlanningValidationLabel(context.outOfPlanningValidationStatus)}
                </p>
              ) : null}
              {context.isLate ? (
                <p className="mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-800">
                  Arrivee apres 08:30
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
                <p><span className="font-semibold text-slate-950">Tache :</span> {context.taskAction ?? (isProfessionalTravelContext(context) ? 'Deplacement professionnel' : context.presenceContext === 'OFFICE' ? 'Pointage bureau' : 'Aucune tache terrain planifiee')}</p>
                {context.teamName ? <p><span className="font-semibold text-slate-950">Equipe :</span> {context.teamName}</p> : null}
                {context.teamSupervisorName ? <p><span className="font-semibold text-slate-950">Superviseur referent :</span> {context.teamSupervisorName}</p> : null}
              </div>
              {context.outOfPlanningDecisionNote ? (
                <p className="mt-2 rounded-xl bg-blue-50 p-3 text-sm font-semibold leading-6 text-blue-900">
                  <span className="font-semibold">Note PM :</span> {context.outOfPlanningDecisionNote}
                </p>
              ) : null}
              <PresenceComments comments={getPresenceComments(context)} />
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

function PresenceComments({ comments }: Readonly<{ comments: RhPresenceCommentItem[] }>) {
  if (comments.length === 0) return null;

  return (
    <div className="mt-2 rounded-xl bg-slate-50 p-3 text-sm font-semibold leading-6 text-slate-700">
      <p className="font-semibold text-slate-950">Commentaires :</p>
      <div className="mt-2 space-y-2">
        {comments.map((item) => (
          <div className="rounded-lg bg-white px-3 py-2" key={`${item.type}:${item.recordedAt}:${item.comment}`}>
            <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
              {item.label} - {formatTime(item.recordedAt)}
            </p>
            <p className="mt-1 whitespace-pre-line text-slate-700">{item.comment}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function getPresenceComments(context: Pick<LiveResourceContext, 'zoneComment' | 'comments' | 'arrivalAt'>) {
  const comments: RhPresenceCommentItem[] = [];
  const addComment = (item: RhPresenceCommentItem) => {
    const normalized = item.comment.trim();
    if (!normalized) return;
    if (!comments.some((comment) => comment.type === item.type && comment.comment.toLowerCase() === normalized.toLowerCase())) {
      comments.push({ ...item, comment: normalized });
    }
  };

  for (const item of context.comments ?? []) {
    if (typeof item === 'string') {
      addComment({
        type: 'UNKNOWN',
        label: 'Commentaire',
        comment: item,
        recordedAt: context.arrivalAt ?? new Date(0).toISOString(),
      });
    } else {
      addComment(item);
    }
  }

  if (context.zoneComment && !comments.some((item) => item.comment.toLowerCase() === context.zoneComment?.toLowerCase())) {
    addComment({
      type: 'ARRIVAL',
      label: 'Commentaire arrivee',
      comment: context.zoneComment,
      recordedAt: context.arrivalAt ?? new Date(0).toISOString(),
    });
  }

  return comments.sort((left, right) => new Date(left.recordedAt).getTime() - new Date(right.recordedAt).getTime());
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

const directionReportTabs: { id: DirectionReportTab; label: string }[] = [
  { id: 'not-clocked-today', label: "Pas pointe aujourd'hui" },
  { id: 'never-clocked', label: 'Jamais pointe' },
  { id: 'clocked-today', label: "Ont pointe aujourd'hui" },
  { id: 'departure-only', label: 'Sortie seule' },
];

function DirectionAttendanceReportPanel({
  activeTab,
  data,
  isFetching,
  isLoading,
  onExportCsv,
  onRefresh,
  onTabChange,
}: Readonly<{
  activeTab: DirectionReportTab;
  data: RhDirectionAttendanceReportResponse | null;
  isFetching: boolean;
  isLoading: boolean;
  onExportCsv: () => void;
  onRefresh: () => void;
  onTabChange: (tab: DirectionReportTab) => void;
}>) {
  const users = data ? getDirectionReportUsers(data, activeTab) : [];

  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-600">Rapport Direction</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Adoption du pointage</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            Synthese des utilisateurs actifs : pointage du jour, absence de pointage du jour, et comptes sans aucun pointage.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={onRefresh}
            type="button"
          >
            Actualiser
          </button>
          <button
            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            disabled={!data}
            onClick={onExportCsv}
            type="button"
          >
            Export CSV
          </button>
        </div>
      </div>

      {isLoading && !data ? (
        <p className="mt-5 text-sm font-semibold text-slate-500">Chargement du rapport...</p>
      ) : null}

      {data ? (
        <>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <DirectionMetric label="Utilisateurs actifs" value={data.summary.activeUsers} />
            <DirectionMetric label="Ont pointe" tone="success" value={data.summary.clockedToday} />
            <DirectionMetric label="Pas pointe ce jour" tone="warning" value={data.summary.notClockedToday} />
            <DirectionMetric label="Jamais pointe" tone={data.summary.neverClocked > 0 ? 'danger' : 'neutral'} value={data.summary.neverClocked} />
            <DirectionMetric label="Sortis" value={data.summary.leftToday} />
            <DirectionMetric label="Sessions ouvertes" tone={data.summary.openSessions > 0 ? 'warning' : 'neutral'} value={data.summary.openSessions} />
            <DirectionMetric label="Retards" tone={data.summary.lateToday > 0 ? 'warning' : 'neutral'} value={data.summary.lateToday} />
            <DirectionMetric label="Sortie sans entree" tone={data.summary.departureOnlyToday > 0 ? 'danger' : 'neutral'} value={data.summary.departureOnlyToday} />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {directionReportTabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.1em] transition ${
                    active ? 'bg-slate-950 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  type="button"
                >
                  {tab.label} <span className="ml-1">{getDirectionReportUsers(data, tab.id).length}</span>
                </button>
              );
            })}
          </div>

          {isFetching ? <p className="mt-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Mise a jour du rapport...</p> : null}

          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
            {users.length === 0 ? (
              <div className="bg-slate-50 p-5 text-sm font-semibold text-slate-500">Aucun utilisateur dans cette liste.</div>
            ) : (
              <div className="max-h-96 overflow-auto divide-y divide-slate-100 bg-white">
                {users.map((user) => (
                  <DirectionReportUserRow key={user.id} user={user} />
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function DirectionMetric({
  label,
  value,
  tone = 'neutral',
}: Readonly<{
  label: string;
  value: number;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}>) {
  const toneClassName = {
    neutral: 'bg-slate-50 text-slate-950',
    success: 'bg-emerald-50 text-emerald-900',
    warning: 'bg-orange-50 text-orange-900',
    danger: 'bg-red-50 text-red-900',
  }[tone];

  return (
    <article className={`rounded-2xl px-4 py-3 ${toneClassName}`}>
      <p className="text-[11px] font-black uppercase tracking-[0.12em] opacity-70">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </article>
  );
}

function DirectionReportUserRow({ user }: Readonly<{ user: RhDirectionAttendanceUser }>) {
  return (
    <article className="grid gap-3 p-4 text-sm md:grid-cols-[minmax(0,1.4fr)_minmax(160px,0.8fr)_minmax(160px,0.8fr)] md:items-center">
      <div className="min-w-0">
        <p className="truncate font-semibold text-slate-950">{user.lastName} {user.firstName}</p>
        <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
          {user.matricule ?? 'Sans matricule'} - {formatRoleLabel(user.role as Role)}
        </p>
      </div>
      <div className="text-slate-600">
        <p>Entree jour : <span className="font-semibold text-slate-900">{user.todayArrivalAt ? formatTime(user.todayArrivalAt) : '-'}</span></p>
        <p className="mt-1">Sortie jour : <span className="font-semibold text-slate-900">{user.todayDepartureAt ? formatTime(user.todayDepartureAt) : '-'}</span></p>
      </div>
      <div className="text-slate-600">
        <p>Dernier pointage : <span className="font-semibold text-slate-900">{user.lastClockInAt ? formatDateTime(user.lastClockInAt) : '-'}</span></p>
        <p className="mt-1">Compte cree : <span className="font-semibold text-slate-900">{formatDate(user.createdAt)}</span></p>
      </div>
    </article>
  );
}

function getDirectionReportUsers(data: RhDirectionAttendanceReportResponse, tab: DirectionReportTab) {
  if (tab === 'clocked-today') return data.users.clockedToday;
  if (tab === 'never-clocked') return data.users.neverClocked;
  if (tab === 'departure-only') return data.users.departureOnlyToday;
  return data.users.notClockedToday;
}

function exportDirectionReportCsv(data: RhDirectionAttendanceReportResponse | undefined) {
  if (!data) return;
  const rows = [
    ['liste', 'matricule', 'nom', 'prenom', 'role', 'entree_jour', 'sortie_jour', 'premier_pointage', 'dernier_pointage', 'compte_cree'],
    ...data.users.clockedToday.map((user) => directionReportCsvRow('ont_pointe', user)),
    ...data.users.notClockedToday.map((user) => directionReportCsvRow('pas_pointe_ce_jour', user)),
    ...data.users.neverClocked.map((user) => directionReportCsvRow('jamais_pointe', user)),
    ...data.users.departureOnlyToday.map((user) => directionReportCsvRow('sortie_sans_entree', user)),
  ];
  const csv = rows.map((row) => row.map(escapeCsvValue).join(';')).join('\n');
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `rapport-direction-pointage-${data.date}.csv`);
}

function directionReportCsvRow(listName: string, user: RhDirectionAttendanceUser) {
  return [
    listName,
    user.matricule ?? '',
    user.lastName,
    user.firstName,
    formatRoleLabel(user.role as Role),
    user.todayArrivalAt ? formatTime(user.todayArrivalAt) : '',
    user.todayDepartureAt ? formatTime(user.todayDepartureAt) : '',
    user.firstClockInAt ? formatDateTime(user.firstClockInAt) : '',
    user.lastClockInAt ? formatDateTime(user.lastClockInAt) : '',
    formatDate(user.createdAt),
  ];
}

function escapeCsvValue(value: string) {
  const normalized = value.replace(/"/g, '""');
  return /[;"\n]/.test(normalized) ? `"${normalized}"` : normalized;
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

const quickFilterDefinitions: { id: PresenceQuickFilter; label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }[] = [
  { id: 'all', label: 'Tous', tone: 'neutral' },
  { id: 'present', label: 'Presents', tone: 'success' },
  { id: 'paused', label: 'Pause', tone: 'warning' },
  { id: 'absent', label: 'Absents', tone: 'danger' },
  { id: 'left', label: 'Sortis', tone: 'neutral' },
  { id: 'late', label: 'Retards', tone: 'warning' },
  { id: 'out-of-planning', label: 'Hors planning', tone: 'info' },
  { id: 'anomaly', label: 'Anomalies', tone: 'danger' },
];

function QuickFilterTabs({
  activeFilter,
  counts,
  onChange,
}: Readonly<{
  activeFilter: PresenceQuickFilter;
  counts: Record<PresenceQuickFilter, number>;
  onChange: (filter: PresenceQuickFilter) => void;
}>) {
  return (
    <div className="sticky top-2 z-20 mb-4 rounded-2xl border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur">
      <div className="flex flex-wrap gap-1.5">
        {quickFilterDefinitions.map((filter) => {
          const active = activeFilter === filter.id;
          return (
            <button
              className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-bold uppercase tracking-[0.08em] transition ${
                active
                  ? quickFilterActiveClassName(filter.tone)
                  : 'bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-950'
              }`}
              key={filter.id}
              onClick={() => onChange(filter.id)}
              type="button"
            >
              <span>{filter.label}</span>
              <span className={`min-w-7 rounded-full px-2 py-0.5 text-center text-[11px] font-black ${active ? 'bg-white/80 text-inherit' : 'bg-slate-100 text-slate-500'}`}>
                {counts[filter.id]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function quickFilterActiveClassName(tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info') {
  const classes = {
    neutral: 'bg-slate-950 text-white shadow-sm',
    success: 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200',
    warning: 'bg-orange-100 text-orange-800 ring-1 ring-orange-200',
    danger: 'bg-red-100 text-red-800 ring-1 ring-red-200',
    info: 'bg-blue-100 text-blue-800 ring-1 ring-blue-200',
  };

  return classes[tone];
}

function Field({ children, label }: Readonly<{ children: ReactNode; label: string }>) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      {children}
    </label>
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

function getLiveResourceStatusLabel(resource: Pick<RhSitePresenceLiveResource, 'status' | 'anomalyReason' | 'presenceContext' | 'taskAction' | 'outOfPlanningValidationStatus'>) {
  if (isOutOfPlanningContext(resource)) {
    const validationSuffix = resource.outOfPlanningValidationStatus ? ` - ${outOfPlanningValidationShortLabel(resource.outOfPlanningValidationStatus)}` : '';
    if (resource.status === 'PRESENT') return `Present hors planning${validationSuffix}`;
    if (resource.status === 'PAUSED') return `Pause hors planning${validationSuffix}`;
    if (resource.status === 'LEFT') return `Sorti hors planning${validationSuffix}`;
  }

  if (resource.status !== 'ANOMALY') return liveStatusLabel(resource.status);
  return 'Anomalie';
}

function isOutOfPlanningContext(resource: Pick<RhSitePresenceLiveResource, 'status' | 'presenceContext' | 'taskAction' | 'outOfPlanningValidationStatus'>) {
  return (
    resource.presenceContext === 'TERRAIN' &&
    (Boolean(resource.outOfPlanningValidationStatus) || !resource.taskAction) &&
    resource.status !== 'EXPECTED_NOT_CLOCKED'
  );
}

function getResourceOutOfPlanningStatus(contexts: LiveResourceContext[]) {
  return contexts.find((context) => context.outOfPlanningValidationStatus)?.outOfPlanningValidationStatus ?? null;
}

function OutOfPlanningValidationBadge({ status }: Readonly<{ status: NonNullable<RhSitePresenceLiveResource['outOfPlanningValidationStatus']> }>) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${outOfPlanningValidationToneClass(status)}`}>
      {outOfPlanningValidationLabel(status)}
    </span>
  );
}

function outOfPlanningValidationLabel(status: NonNullable<RhSitePresenceLiveResource['outOfPlanningValidationStatus']>) {
  if (status === 'VALIDATED') return 'Valide PM';
  if (status === 'REFUSED') return 'Refuse PM';
  return 'Validation PM en attente';
}

function outOfPlanningValidationShortLabel(status: NonNullable<RhSitePresenceLiveResource['outOfPlanningValidationStatus']>) {
  if (status === 'VALIDATED') return 'valide PM';
  if (status === 'REFUSED') return 'refuse PM';
  return 'validation PM en attente';
}

function outOfPlanningValidationToneClass(status: NonNullable<RhSitePresenceLiveResource['outOfPlanningValidationStatus']>) {
  if (status === 'VALIDATED') return 'bg-emerald-100 text-emerald-800';
  if (status === 'REFUSED') return 'bg-red-100 text-red-800';
  return 'bg-amber-100 text-amber-800';
}

function liveStatusTone(status: RhSitePresenceLiveStatus) {
  if (status === 'PRESENT') return 'success';
  if (status === 'PAUSED') return 'warning';
  if (status === 'EXPECTED_NOT_CLOCKED') return 'error';
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
      siteAddress: getLiveResourcePositionLabel(resource, site.siteName, site.siteAddress),
      projectName: site.projectName,
    })),
  );
}

function getLiveResourcePositionLabel(resource: RhSitePresenceLiveResource, siteName: string, fallback: string) {
  if (!resource.zoneActualName) return fallback;

  if (resource.presenceContext === 'OFFICE' && siteName === 'Deplacement professionnel') {
    return resource.zoneSpecificPlace
      ? `${resource.zoneActualName} - ${resource.zoneSpecificPlace}`
      : resource.zoneActualName;
  }

  return resource.zoneSpecificPlace
    ? `Zone - ${resource.zoneActualName} (${resource.zoneSpecificPlace})`
    : `Zone - ${resource.zoneActualName}`;
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

function sortAggregatedLiveResources(resources: AggregatedLiveResource[], sortMode: PresenceSortMode) {
  return [...resources].sort((left, right) => compareAggregatedLiveResource(left, right, sortMode));
}

function compareAggregatedLiveResource(left: AggregatedLiveResource, right: AggregatedLiveResource, sortMode: PresenceSortMode) {
  if (sortMode === 'arrival-asc') {
    return compareArrivalTime(left, right, 'asc') || compareLivePresenceResource(left, right);
  }

  if (sortMode === 'arrival-desc') {
    return compareArrivalTime(left, right, 'desc') || compareLivePresenceResource(left, right);
  }

  return compareLivePresenceResource(left, right);
}

function compareArrivalTime(left: AggregatedLiveResource, right: AggregatedLiveResource, direction: 'asc' | 'desc') {
  const leftTime = arrivalSortTime(left.arrivalAt);
  const rightTime = arrivalSortTime(right.arrivalAt);

  if (leftTime === rightTime) return 0;
  if (leftTime === null) return 1;
  if (rightTime === null) return -1;

  return direction === 'asc' ? leftTime - rightTime : rightTime - leftTime;
}

function arrivalSortTime(value: string | null) {
  return value ? new Date(value).getTime() : null;
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
    isLate: isDailyLate(sortedContexts),
    contexts: sortedContexts,
  };
}

function compareLivePresenceContext(left: LiveResourceContext, right: LiveResourceContext) {
  const statusDiff = liveStatusSortRank(left.status) - liveStatusSortRank(right.status);
  if (statusDiff !== 0) return statusDiff;
  return left.siteName.localeCompare(right.siteName);
}

function isDailyLate(contexts: LiveResourceContext[]) {
  const firstArrival = contexts
    .filter((context) => context.arrivalAt && !isForgottenExitContext(context))
    .sort((left, right) => left.arrivalAt!.localeCompare(right.arrivalAt!))[0];

  return Boolean(firstArrival?.isLate);
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

function buildQuickFilterCounts(resources: AggregatedLiveResource[]): Record<PresenceQuickFilter, number> {
  return resources.reduce(
    (counts, resource) => {
      counts.all += 1;
      if (matchesQuickFilter(resource, 'present')) counts.present += 1;
      if (matchesQuickFilter(resource, 'paused')) counts.paused += 1;
      if (matchesQuickFilter(resource, 'absent')) counts.absent += 1;
      if (matchesQuickFilter(resource, 'left')) counts.left += 1;
      if (matchesQuickFilter(resource, 'late')) counts.late += 1;
      if (matchesQuickFilter(resource, 'out-of-planning')) counts['out-of-planning'] += 1;
      if (matchesQuickFilter(resource, 'anomaly')) counts.anomaly += 1;
      return counts;
    },
    {
      all: 0,
      present: 0,
      presentTerrain: 0,
      presentOffice: 0,
      paused: 0,
      absent: 0,
      left: 0,
      late: 0,
      oldSessionDepartures: 0,
      'out-of-planning': 0,
      anomaly: 0,
    },
  );
}

function matchesQuickFilter(resource: AggregatedLiveResource, filter: PresenceQuickFilter) {
  if (filter === 'all') return true;
  if (filter === 'present') return hasPresenceDuringSelectedDay(resource);
  if (filter === 'paused') return resource.status === 'PAUSED';
  if (filter === 'absent') return resource.status === 'EXPECTED_NOT_CLOCKED';
  if (filter === 'left') return resource.status === 'LEFT';
  if (filter === 'late') return resource.isLate;
  if (filter === 'out-of-planning') return resource.contexts.some(isOutOfPlanningContext);
  if (filter === 'anomaly') return resource.status === 'ANOMALY' || Boolean(resource.anomalyReason);
  return true;
}
function hasPresenceDuringSelectedDay(resource: Pick<AggregatedLiveResource, 'contexts'>) {
  return resource.contexts.some((context) => Boolean(context.arrivalAt) && context.status !== 'EXPECTED_NOT_CLOCKED');
}

function hasPresenceContextDuringSelectedDay(
  resource: Pick<AggregatedLiveResource, 'contexts'>,
  presenceContext: 'TERRAIN' | 'OFFICE',
) {
  return resource.contexts.some(
    (context) =>
      context.presenceContext === presenceContext &&
      Boolean(context.arrivalAt) &&
      context.status !== 'EXPECTED_NOT_CLOCKED',
  );
}
function isOldSessionDepartureOnly(resource: Pick<AggregatedLiveResource, 'contexts' | 'status'>) {
  return resource.status === 'LEFT' && resource.contexts.every((context) => !context.arrivalAt && context.lastClockInType === 'DEPARTURE');
}
function buildDisplaySummary(resources: AggregatedLiveResource[]) {
  return resources.reduce(
    (summary, resource) => {
      if (resource.contexts.some(isExpectedContext)) summary.expected += 1;
      if (hasPresenceDuringSelectedDay(resource)) {
        summary.present += 1;
        if (hasPresenceContextDuringSelectedDay(resource, 'TERRAIN')) summary.presentTerrain += 1;
        if (hasPresenceContextDuringSelectedDay(resource, 'OFFICE')) summary.presentOffice += 1;
      }
      if (resource.status === 'PAUSED') summary.paused += 1;
      if (resource.status === 'EXPECTED_NOT_CLOCKED') summary.absent += 1;
      if (resource.status === 'LEFT') summary.left += 1;
      if (isOldSessionDepartureOnly(resource)) summary.oldSessionDepartures += 1;
      if (resource.status === 'ANOMALY') summary.anomaly += 1;
      if (resource.isLate) summary.late += 1;
      return summary;
    },
    {
      expected: 0,
      present: 0,
      presentTerrain: 0,
      presentOffice: 0,
      paused: 0,
      absent: 0,
      left: 0,
      anomaly: 0,
      late: 0,
      oldSessionDepartures: 0,
    },
  );
}


function isExpectedContext(context: LiveResourceContext) {
  return Boolean(context.taskAction) || context.status === 'EXPECTED_NOT_CLOCKED';
}

function presenceContextLabel(context: Pick<LiveResourceContext, 'presenceContext' | 'siteName'>) {
  if (isProfessionalTravelContext(context)) return 'Deplacement';
  return context.presenceContext === 'OFFICE' ? 'Bureau' : 'Terrain';
}

function contextTitleLabel(context: Pick<LiveResourceContext, 'presenceContext' | 'siteName'>) {
  if (isProfessionalTravelContext(context)) return 'Deplacement professionnel';
  return `${presenceContextLabel(context)} - ${context.siteName}`;
}

function isProfessionalTravelContext(context: Pick<LiveResourceContext, 'presenceContext' | 'siteName'>) {
  return context.presenceContext === 'OFFICE' && context.siteName === 'Deplacement professionnel';
}

function clockInTypeLabel(type: string | null) {
  if (type === 'ARRIVAL') return 'Entree';
  if (type === 'DEPARTURE') return 'Sortie';
  if (type === 'PAUSE_START') return 'Pause';
  if (type === 'PAUSE_END') return 'Reprise';
  return 'Pointage';
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('fr-FR');
}

function formatDateTime(value: string) {
  const date = new Date(value);
  return `${date.toLocaleDateString('fr-FR')} ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
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
