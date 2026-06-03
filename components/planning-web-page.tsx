'use client';

import Link from 'next/link';
import { PlanningAssignmentStatus, PlanningWorkLocationType, type Role } from '@prisma/client';
import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Download, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { TableActionsMenu } from '@/components/table-actions-menu';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import { formatRoleLabel } from '@/lib/role-labels';
import type {
  CentralizedPlanningAssignment,
  CentralizedPlanningFilters,
  CentralizedPlanningResponse,
  PlanningWebAssignment,
  PlanningWebCreateRequest,
  PlanningWebDayResponse,
  PlanningWebFilters,
  PlanningWebMutationResponse,
  PlanningWebUpdateRequest,
} from '@/types/planning-web';
import type { AvailableSite, UnassignedSupervisor } from '@/types/mobile-planning';

type PlanningWebPageProps = Readonly<{
  viewer: {
    role: Role;
  };
}>;

type ViewMode = 'day' | 'week' | 'centralized';
type DrawerMode = 'create' | 'edit';
type PlanningAssignmentGroup = {
  supervisorId: string;
  supervisorFirstName: string;
  supervisorName: string;
  assignments: PlanningWebAssignment[];
};

type AssignmentFormState = {
  id?: string;
  supervisorId: string;
  projectId: string;
  siteId: string;
  date: string;
  action: string;
  targetProgress: string;
  targetQuantity: string;
  targetUnit: string;
  objectiveText: string;
  status: PlanningAssignmentStatus;
  workLocationType: PlanningWorkLocationType;
};

type FreeMissionWebRequest = {
  projectId: string;
  assigneeId: string;
  date: string;
  action: string;
  objectiveText: string | null;
};

const todayKey = formatDateKey(new Date());
const filterClassName =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-500';
const buttonClassName =
  'rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

const planningStatusLabel: Record<PlanningAssignmentStatus, string> = {
  ASSIGNED: 'Non dÃ©marrÃ©',
  IN_PROGRESS: 'En cours',
  COMPLETED: 'TerminÃ©',
  CANCELLED: 'AnnulÃ©',
};

const workLocationTypeLabel: Record<PlanningWorkLocationType, string> = {
  ON_SITE: 'PrÃ©sence chantier requise',
  OFFICE: 'TÃ¢che bureau / coordination',
  FREE_MISSION: 'Mission libre',
};

const objectiveStatusConfig = {
  NOT_STARTED: { label: 'Non dÃ©marrÃ©', tone: 'neutral' },
  PARTIAL: { label: 'Partiel', tone: 'warning' },
  ACHIEVED: { label: 'Atteint', tone: 'success' },
  BLOCKED: { label: 'BloquÃ©', tone: 'error' },
} as const;

export function PlanningWebPage({ viewer }: PlanningWebPageProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const isCentralizedOnlyPlanning = viewer.role === 'DIRECTION' || viewer.role === 'ADMIN';
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [viewMode, setViewMode] = useState<ViewMode>(() => (isCentralizedOnlyPlanning ? 'centralized' : 'day'));
  const [filters, setFilters] = useState<PlanningWebFilters>({ projectId: '', siteId: '', resourceId: '' });
  const [centralizedFilters, setCentralizedFilters] = useState<CentralizedPlanningFilters>({
    from: todayKey,
    to: todayKey,
    projectId: '',
    siteId: '',
    resourceId: '',
    role: '',
    workLocationType: '',
  });
  const [drawerMode, setDrawerMode] = useState<DrawerMode | null>(null);
  const [form, setForm] = useState<AssignmentFormState>(() => createEmptyForm(selectedDate));
  const [deleteTarget, setDeleteTarget] = useState<PlanningWebAssignment | null>(null);
  const canMutate =
    viewer.role === 'GENERAL_SUPERVISOR' ||
    viewer.role === 'BE_MANAGER' ||
    viewer.role === 'NEGOTIATION_MANAGER' ||
    viewer.role === 'FLEET_MANAGER' ||
    viewer.role === 'PROJECT_MANAGER';
  const canAccessCentralized = viewer.role === 'PROJECT_MANAGER' || viewer.role === 'DIRECTION' || viewer.role === 'ADMIN';
  const canViewCentralized =
    viewer.role === 'BE_MANAGER' ||
    viewer.role === 'NEGOTIATION_MANAGER' ||
    viewer.role === 'FLEET_MANAGER' ||
    canAccessCentralized;

  const dayQuery = useQuery({
    queryKey: ['web-planning', selectedDate],
    queryFn: () => fetchPlanningDay(selectedDate),
    enabled: !isCentralizedOnlyPlanning,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
  const weekQueries = useQueries({
    queries: weekDates.map((date) => ({
      queryKey: ['web-planning', date],
      queryFn: () => fetchPlanningDay(date),
      enabled: !isCentralizedOnlyPlanning && viewMode === 'week',
      staleTime: 30_000,
    })),
  });
  const centralizedQuery = useQuery({
    queryKey: ['web-planning-centralized', centralizedFilters],
    queryFn: () => fetchCentralizedPlanning(centralizedFilters),
    enabled: canViewCentralized && viewMode === 'centralized',
    staleTime: 30_000,
  });
  const assignmentConflictsQuery = useQuery({
    queryKey: ['web-planning-resource-conflicts', form.date, form.supervisorId],
    queryFn: () =>
      fetchCentralizedPlanning({
        from: form.date,
        to: form.date,
        projectId: '',
        siteId: '',
        resourceId: form.supervisorId,
        role: '',
        workLocationType: '',
      }),
    enabled: canMutate && canViewCentralized && Boolean(drawerMode && form.date && form.supervisorId),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (isCentralizedOnlyPlanning && viewMode !== 'centralized') {
      setViewMode('centralized');
    }
  }, [isCentralizedOnlyPlanning, viewMode]);

  const createMutation = useMutation({
    mutationFn: createAssignment,
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'TÃ¢che crÃ©Ã©e' });
      closeDrawer();
      await queryClient.invalidateQueries({ queryKey: ['web-planning'] });
    },
    onError: (error) => pushMutationError(error, "Creation impossible"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PlanningWebUpdateRequest }) => updateAssignment(id, data),
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'TÃ¢che modifiÃ©e' });
      closeDrawer();
      await queryClient.invalidateQueries({ queryKey: ['web-planning'] });
    },
    onError: (error) => pushMutationError(error, 'Modification impossible'),
  });

  const freeMissionMutation = useMutation({
    mutationFn: ({ id, data }: { id?: string; data: FreeMissionWebRequest }) =>
      id ? updateFreeMission(id, data) : createFreeMission(data),
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Mission libre enregistree' });
      closeDrawer();
      await queryClient.invalidateQueries({ queryKey: ['web-planning'] });
    },
    onError: (error) => pushMutationError(error, 'Mission libre impossible'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAssignment,
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'TÃ¢che supprimÃ©e' });
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['web-planning'] });
    },
    onError: (error) => pushMutationError(error, 'Suppression impossible'),
  });

  const data = dayQuery.data;
  const filteredAssignments = useMemo(
    () => filterAssignments(data?.assignments ?? [], data?.availableSites ?? [], filters),
    [data, filters],
  );
  const projects = useMemo(() => getProjectOptions(data?.availableSites ?? []), [data]);
  const sites = data?.availableSites ?? [];
  const resources = data?.unassignedSupervisors ?? [];
  const centralizedItems = useMemo(() => centralizedQuery.data?.items ?? [], [centralizedQuery.data?.items]);
  const centralizedOptions = useMemo(() => getCentralizedOptions(centralizedItems), [centralizedItems]);
  const selectedDateObject = parseDateKey(selectedDate);
  const isMutating = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending || freeMissionMutation.isPending;
  const assignmentConflicts =
    assignmentConflictsQuery.data?.items.filter((item) => item.id !== form.id && item.siteId !== form.siteId) ?? [];

  function setFilter(key: keyof PlanningWebFilters, value: string) {
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === 'projectId' ? { siteId: '' } : {}),
    }));
  }

  function setCentralizedFilter(key: keyof CentralizedPlanningFilters, value: string) {
    setCentralizedFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === 'projectId' ? { siteId: '' } : {}),
    }));
  }

  function navigateDate(days: number) {
    const nextDate = formatDateKey(addDays(selectedDateObject, days));
    setSelectedDate(nextDate);
    setForm((current) => ({ ...current, date: nextDate }));
  }

  function openCreate(resourceId?: string) {
    setForm({
      ...createEmptyForm(selectedDate),
      supervisorId: resourceId ?? '',
    });
    setDrawerMode('create');
  }

  function openEdit(assignment: PlanningWebAssignment) {
    setForm({
      id: assignment.id,
      supervisorId: assignment.supervisorId,
      projectId: assignment.projectId ?? sites.find((site) => site.id === assignment.siteId)?.project.id ?? '',
      siteId: assignment.siteId ?? '',
      date: selectedDate,
      action: assignment.action,
      targetProgress: assignment.targetProgress === null ? '' : String(assignment.targetProgress),
      targetQuantity: assignment.targetQuantity === null ? '' : String(assignment.targetQuantity),
      targetUnit: assignment.targetUnit ?? '',
      objectiveText: assignment.objectiveText ?? '',
      status: assignment.status,
      workLocationType: assignment.workLocationType,
    });
    setDrawerMode('edit');
  }

  function closeDrawer() {
    setDrawerMode(null);
    setForm(createEmptyForm(selectedDate));
  }

  function submitForm() {
    const targetProgress = form.targetProgress === '' ? null : Number(form.targetProgress);
    const targetQuantity = form.targetQuantity === '' ? null : Number(form.targetQuantity);
    const normalizedTargetProgress = targetQuantity !== null && targetQuantity > 0 ? null : targetProgress;
    const targetUnit = form.targetUnit.trim() || null;

    if (form.workLocationType === PlanningWorkLocationType.FREE_MISSION) {
      const data = {
        projectId: form.projectId,
        assigneeId: form.supervisorId,
        date: form.date,
        action: form.action,
        objectiveText: form.objectiveText.trim() || null,
      };
      freeMissionMutation.mutate(drawerMode === 'edit' && form.id ? { id: form.id, data } : { data });
      return;
    }

    if (drawerMode === 'create') {
      const payload: PlanningWebCreateRequest = {
        supervisorId: form.supervisorId,
        siteId: form.siteId,
        action: form.action,
        targetProgress: normalizedTargetProgress,
        targetQuantity,
        targetUnit,
        objectiveText: form.objectiveText.trim() || null,
        date: form.date,
        workLocationType: form.workLocationType,
      };
      createMutation.mutate(payload);
      return;
    }

    if (drawerMode === 'edit' && form.id) {
      updateMutation.mutate({
        id: form.id,
        data: {
          action: form.action,
          targetProgress: normalizedTargetProgress,
          targetQuantity,
          targetUnit,
          objectiveText: form.objectiveText.trim() || null,
          status: form.status,
          workLocationType: form.workLocationType,
        },
      });
    }
  }

  function pushMutationError(error: unknown, title: string) {
    pushToast({
      type: 'error',
      title,
      message: error instanceof Error ? error.message : 'OpÃ©ration refusÃ©e.',
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">
              {isCentralizedOnlyPlanning ? 'Planning centralise' : 'Planning terrain'}
            </p>
            {isCentralizedOnlyPlanning ? (
              <>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Planning centralise</h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                  Consulte toutes les affectations en lecture seule pour suivre les disponibilites.
                </p>
              </>
            ) : null}
            {!isCentralizedOnlyPlanning ? (
              <>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">TÃ¢ches journaliÃ¨res</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Planifie les ressources terrain par chantier, avec consultation jour ou semaine.
            </p>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isCentralizedOnlyPlanning ? <Badge tone="info">Vue centralisee</Badge> : null}
            {!isCentralizedOnlyPlanning ? (
              <>
            <Badge tone={dayQuery.isFetching ? 'warning' : 'info'}>
              {dayQuery.isFetching ? 'Actualisation...' : formatLongDate(selectedDateObject)}
            </Badge>
              </>
            ) : null}
            {!canMutate ? <Badge tone="neutral">Lecture seule</Badge> : null}
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
        {isCentralizedOnlyPlanning ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">Lecture globale</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-950">Planning centralise uniquement</h2>
              <p className="mt-1 text-sm text-slate-600">
                Les affectations sont consultables, sans creation ni modification depuis ce role.
              </p>
            </div>
            <div className="flex justify-end">
              <SegmentedButton active={viewMode === 'centralized'} onClick={() => setViewMode('centralized')}>
                Centralise
              </SegmentedButton>
            </div>
          </div>
        ) : null}
        {!isCentralizedOnlyPlanning ? (
        <div className="grid gap-4 xl:grid-cols-[auto_1fr_auto] xl:items-end">
          <div className="flex flex-wrap gap-2">
            <button className={buttonClassName} onClick={() => navigateDate(-1)} type="button">
              Hier
            </button>
            <button className={buttonClassName} onClick={() => setSelectedDate(todayKey)} type="button">
              Aujourd&apos;hui
            </button>
            <button className={buttonClassName} onClick={() => navigateDate(1)} type="button">
              Demain
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Date">
              <input
                className={filterClassName}
                onChange={(event) => setSelectedDate(event.target.value)}
                type="date"
                value={selectedDate}
              />
            </Field>
            <Field label="Projet">
              <select className={filterClassName} onChange={(event) => setFilter('projectId', event.target.value)} value={filters.projectId}>
                <option value="">Tous</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Chantier">
              <select className={filterClassName} onChange={(event) => setFilter('siteId', event.target.value)} value={filters.siteId}>
                <option value="">Tous</option>
                {sites
                  .filter((site) => !filters.projectId || site.project.id === filters.projectId)
                  .map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Ressource">
              <select className={filterClassName} onChange={(event) => setFilter('resourceId', event.target.value)} value={filters.resourceId}>
                <option value="">Toutes</option>
                {resources.map((resource) => (
                  <option key={resource.id} value={resource.id}>
                    {resource.firstName} {resource.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <SegmentedButton active={viewMode === 'day'} onClick={() => setViewMode('day')}>
              Jour
            </SegmentedButton>
            <SegmentedButton active={viewMode === 'week'} onClick={() => setViewMode('week')}>
              Semaine
            </SegmentedButton>
            {canViewCentralized ? (
              <SegmentedButton active={viewMode === 'centralized'} onClick={() => setViewMode('centralized')}>
                CentralisÃ©
              </SegmentedButton>
            ) : null}
          </div>
        </div>
        ) : null}
      </section>

      {viewMode === 'centralized' ? (
        <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Field label="Du">
              <input
                className={filterClassName}
                onChange={(event) => setCentralizedFilter('from', event.target.value)}
                type="date"
                value={centralizedFilters.from}
              />
            </Field>
            <Field label="Au">
              <input
                className={filterClassName}
                onChange={(event) => setCentralizedFilter('to', event.target.value)}
                type="date"
                value={centralizedFilters.to}
              />
            </Field>
            <Field label="Projet">
              <select
                className={filterClassName}
                onChange={(event) => setCentralizedFilter('projectId', event.target.value)}
                value={centralizedFilters.projectId}
              >
                <option value="">Tous</option>
                {centralizedOptions.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Chantier">
              <select
                className={filterClassName}
                onChange={(event) => setCentralizedFilter('siteId', event.target.value)}
                value={centralizedFilters.siteId}
              >
                <option value="">Tous</option>
                {centralizedOptions.sites
                  .filter((site) => !centralizedFilters.projectId || site.projectId === centralizedFilters.projectId)
                  .map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Ressource">
              <select
                className={filterClassName}
                onChange={(event) => setCentralizedFilter('resourceId', event.target.value)}
                value={centralizedFilters.resourceId}
              >
                <option value="">Toutes</option>
                {centralizedOptions.resources.map((resource) => (
                  <option key={resource.id} value={resource.id}>
                    {resource.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="RÃ´le">
              <select
                className={filterClassName}
                onChange={(event) => setCentralizedFilter('role', event.target.value)}
                value={centralizedFilters.role}
              >
                <option value="">Tous</option>
                {centralizedOptions.roles.map((role) => (
                  <option key={role} value={role}>
                    {formatRoleLabel(role)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Type">
              <select
                className={filterClassName}
                onChange={(event) => setCentralizedFilter('workLocationType', event.target.value)}
                value={centralizedFilters.workLocationType}
              >
                <option value="">Tous</option>
                {Object.values(PlanningWorkLocationType).map((type) => (
                  <option key={type} value={type}>
                    {type === 'OFFICE' ? 'Bureau' : 'Terrain'}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>
      ) : null}

      {data && viewMode !== 'centralized' ? (
        <section className="grid gap-4 md:grid-cols-4">
          <MetricCard label="TÃ¢ches" value={data.assignments.length} />
          <MetricCard label="Ressources actives" value={data.unassignedSupervisors.length} />
          <MetricCard label="Chantiers accessibles" value={data.availableSites.length} />
          <MetricCard label="AffichÃ©es" value={filteredAssignments.length} />
        </section>
      ) : null}

      {canMutate && data && viewMode !== 'centralized' ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Actions planning</h2>
            <p className="mt-1 text-sm text-slate-600">CrÃ©e une tÃ¢che pour une ressource terrain.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              disabled={isMutating}
              onClick={() => void downloadPlanningExport(selectedDate, filters, 'xlsx', pushMutationError)}
              type="button"
            >
              <Download className="h-4 w-4" />
              RÃ©cap Excel
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              disabled={isMutating}
              onClick={() => void downloadPlanningExport(selectedDate, filters, 'pdf', pushMutationError)}
              type="button"
            >
              <Download className="h-4 w-4" />
              RÃ©cap PDF
            </button>
            <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60" disabled={isMutating} onClick={() => openCreate()} type="button">
              Ajouter une tÃ¢che
            </button>
          </div>
        </section>
      ) : null}

      {dayQuery.isError && viewMode !== 'centralized' ? (
        <EmptyState title="Planning indisponible" description="Le planning n'a pas pu etre charge. Verifie ta session puis reessaie." />
      ) : null}

      {dayQuery.isLoading && viewMode !== 'centralized' ? <LoadingState /> : null}

      {data && viewMode === 'day' ? (
        <DayPlanningCards
          assignments={filteredAssignments}
          canMutate={canMutate}
          sites={sites}
          onDelete={setDeleteTarget}
          onEdit={openEdit}
        />
      ) : null}

      {data && viewMode === 'week' ? (
        <WeekPlanningGrid
          dates={weekDates}
          filters={filters}
          queries={weekQueries}
          onSelectDate={(date) => {
            setSelectedDate(date);
            setForm((current) => ({ ...current, date }));
            setViewMode('day');
          }}
        />
      ) : null}

      {viewMode === 'centralized' ? (
        <CentralizedPlanningTable
          items={centralizedItems}
          isError={centralizedQuery.isError}
          isLoading={centralizedQuery.isLoading}
        />
      ) : null}

      {data && viewMode !== 'centralized' ? (
        <ResourcesPanel
          canMutate={canMutate}
          resources={resources}
          onAssign={(resourceId) => openCreate(resourceId)}
        />
      ) : null}

      {drawerMode && data ? (
        <AssignmentDrawer
          canEditIdentity={drawerMode === 'create'}
          form={form}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
          mode={drawerMode}
          projects={projects}
          resources={resources}
          sites={sites}
          onCancel={closeDrawer}
          onChange={setForm}
          onSubmit={submitForm}
          conflicts={assignmentConflicts}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDeleteModal
          assignment={deleteTarget}
          isDeleting={deleteMutation.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
        />
      ) : null}
    </div>
  );
}

function DayPlanningCards({
  assignments,
  sites,
  canMutate,
  onEdit,
  onDelete,
}: Readonly<{
  assignments: PlanningWebAssignment[];
  sites: AvailableSite[];
  canMutate: boolean;
  onEdit: (assignment: PlanningWebAssignment) => void;
  onDelete: (assignment: PlanningWebAssignment) => void;
}>) {
  if (assignments.length === 0) {
    return <EmptyState title="Aucune tÃ¢che" description="Aucune ligne ne correspond aux filtres sÃ©lectionnÃ©s." />;
  }

  const groups = groupAssignmentsByResource(assignments);

  return (
    <section className="space-y-4">
      {groups.map((group) => {
        const terrainCount = group.assignments.filter((assignment) => assignment.workLocationType === 'ON_SITE').length;
        const officeCount = group.assignments.filter((assignment) => assignment.workLocationType === 'OFFICE').length;
        const blockedCount = group.assignments.filter((assignment) => assignment.objectiveStatus === 'BLOCKED').length;

        return (
        <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-panel" key={group.supervisorId}>
          <div className="flex flex-col gap-4 border-b border-slate-100 bg-slate-50/70 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <Link
                className="text-lg font-semibold text-slate-950 underline-offset-4 hover:text-orange-700 hover:underline"
                href={`/web/users/${encodeURIComponent(group.supervisorId)}/assignments-history`}
              >
                {group.supervisorFirstName} {group.supervisorName}
              </Link>
              <p className="mt-1 text-sm text-slate-500">
                Ressource terrain Â· {group.assignments.length} tache(s) Â· {terrainCount} terrain Â· {officeCount} bureau
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="info">{group.assignments.length} tÃ¢che(s)</Badge>
              <Badge tone="neutral">{officeCount} bureau</Badge>
              {blockedCount > 0 ? <Badge tone="error">{blockedCount} bloquÃ©e(s)</Badge> : null}
            </div>
          </div>

          <div className="grid gap-3 p-4 xl:grid-cols-2">
            {group.assignments.map((assignment) => {
              const site = sites.find((item) => item.id === assignment.siteId);
              return (
                <div
                  className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md"
                  key={assignment.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{site?.project.name ?? '-'}</p>
                      <h4 className="mt-1 text-base font-semibold text-slate-950">{assignment.siteName}</h4>
                      <p className="mt-1 line-clamp-1 text-xs text-slate-500">{assignment.siteAddress}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap justify-end gap-2">
                      <Badge tone={assignment.workLocationType === 'OFFICE' ? 'neutral' : assignment.workLocationType === 'FREE_MISSION' ? 'warning' : 'info'}>
                        {assignment.workLocationType === 'OFFICE'
                          ? 'Bureau'
                          : assignment.workLocationType === 'FREE_MISSION'
                            ? 'Mission libre'
                            : 'Terrain'}
                      </Badge>
                      {assignment.siteType === 'FREE_MISSION' ? <Badge tone="warning">Sans chantier fixe</Badge> : null}
                      {site?.siteType === 'INTERVENTION_ZONE' ? <Badge tone="success">Zone d&apos;intervention</Badge> : null}
                      <Badge tone={statusTone(assignment.status)}>{planningStatusLabel[assignment.status]}</Badge>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-3">
                    <PlanningTaskField label="TÃ¢che">
                      <p className="text-sm font-medium text-slate-800">{assignment.action}</p>
                      {assignment.objectiveText ? <p className="mt-1 text-xs text-slate-500">Consigne : {assignment.objectiveText}</p> : null}
                    </PlanningTaskField>
                  </div>

                  <ObjectiveProgressCard assignment={assignment} />

                  <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
                    <p className="text-xs text-slate-500">
                      CrÃ©Ã© par {assignment.createdBy.firstName} {assignment.createdBy.lastName}
                    </p>
                    {canMutate ? (
                      <TableActionsMenu
                        actions={[
                          {
                            label: 'Modifier',
                            icon: <Pencil className="h-4 w-4" />,
                            onClick: () => onEdit(assignment),
                          },
                          {
                            label: 'Supprimer',
                            icon: <Trash2 className="h-4 w-4" />,
                            tone: 'danger',
                            onClick: () => onDelete(assignment),
                          },
                        ]}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </article>
        );
      })}
    </section>
  );
}

function PlanningTaskField({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      {children}
    </div>
  );
}

function WeekPlanningGrid({
  dates,
  filters,
  queries,
  onSelectDate,
}: Readonly<{
  dates: string[];
  filters: PlanningWebFilters;
  queries: UseQueryResult<PlanningWebDayResponse>[];
  onSelectDate: (date: string) => void;
}>) {
  return (
    <section className="grid gap-4 xl:grid-cols-7">
      {dates.map((date, index) => {
        const query = queries[index];
        if (!query) return null;
        const assignments = filterAssignments(query.data?.assignments ?? [], query.data?.availableSites ?? [], filters);
        return (
          <button
            className="rounded-[2rem] border border-slate-200 bg-white p-4 text-left shadow-panel transition hover:border-slate-300 hover:shadow-lg"
            key={date}
            onClick={() => onSelectDate(date)}
            type="button"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{formatWeekday(parseDateKey(date))}</p>
                <h3 className="mt-1 text-base font-semibold text-slate-950">{formatShortDate(parseDateKey(date))}</h3>
              </div>
              <Badge tone={query.isFetching ? 'warning' : 'neutral'}>{assignments.length}</Badge>
            </div>
            <div className="mt-4 space-y-3">
              {query.isLoading ? <div className="h-24 animate-pulse rounded-2xl bg-slate-100" /> : null}
              {assignments.slice(0, 4).map((assignment) => (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3" key={assignment.id}>
                  <p className="truncate text-sm font-semibold text-slate-950">
                    {assignment.supervisorFirstName} {assignment.supervisorName}
                  </p>
                  <p className="truncate text-xs text-slate-600">{assignment.siteName}</p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    {assignment.workLocationType === 'OFFICE' ? 'Bureau' : 'Terrain'}
                  </p>
                </div>
              ))}
              {!query.isLoading && assignments.length === 0 ? <p className="text-sm text-slate-500">Aucune tÃ¢che</p> : null}
              {assignments.length > 4 ? <p className="text-xs font-semibold text-slate-500">+{assignments.length - 4} autre(s)</p> : null}
            </div>
          </button>
        );
      })}
    </section>
  );
}

function CentralizedPlanningTable({
  items,
  isLoading,
  isError,
}: Readonly<{
  items: CentralizedPlanningAssignment[];
  isLoading: boolean;
  isError: boolean;
}>) {
  if (isLoading) {
    return <LoadingState />;
  }

  if (isError) {
    return (
      <EmptyState
        title="Planning centralisÃ© indisponible"
        description="La vue centralisÃ©e n'a pas pu etre chargÃ©e. VÃ©rifie ta session puis rÃ©essaie."
      />
    );
  }

  if (items.length === 0) {
    return <EmptyState title="Aucune affectation" description="Aucune ligne ne correspond aux filtres centralisÃ©s." />;
  }

  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-panel">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Planning centralisÃ©</h2>
            <p className="mt-1 text-sm text-slate-600">Lecture globale des affectations pour arbitrer les disponibilitÃ©s.</p>
          </div>
          <Badge tone="info">{items.length} ligne(s)</Badge>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="px-5 py-3">Date</th>
              <th className="px-5 py-3">Projet</th>
              <th className="px-5 py-3">Chantier</th>
              <th className="px-5 py-3">Ressource</th>
              <th className="px-5 py-3">TÃ¢che</th>
              <th className="px-5 py-3">Type</th>
              <th className="px-5 py-3">Progression</th>
              <th className="px-5 py-3">Statut</th>
              <th className="px-5 py-3">CrÃ©ateur</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr className="align-top" key={item.id}>
                <td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-900">{formatShortDate(parseDateKey(item.date))}</td>
                <td className="px-5 py-4 text-slate-700">{item.projectName}</td>
                <td className="px-5 py-4">
                  <p className="font-semibold text-slate-900">{item.siteName}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.siteAddress}</p>
                  {item.siteType === 'INTERVENTION_ZONE' ? (
                    <div className="mt-2">
                      <Badge tone="success">Zone d&apos;intervention</Badge>
                    </div>
                  ) : null}
                </td>
                <td className="px-5 py-4">
                  <p className="font-semibold text-slate-900">{item.resourceName}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatRoleLabel(item.resourceRole)}</p>
                </td>
                <td className="min-w-64 px-5 py-4 text-slate-700">
                  <p>{item.action}</p>
                  {item.objectiveText ? <p className="mt-1 text-xs text-slate-500">Consigne : {item.objectiveText}</p> : null}
                </td>
                <td className="px-5 py-4">
                  <Badge tone={item.workLocationType === 'OFFICE' ? 'neutral' : 'info'}>
                    {item.workLocationType === 'OFFICE' ? 'Bureau' : 'Terrain'}
                  </Badge>
                </td>
                <td className="px-5 py-4">
                  <CentralizedProgressSummary assignment={item} />
                </td>
                <td className="px-5 py-4">
                  <CentralizedStatusBadge item={item} />
                </td>
                <td className="px-5 py-4">
                  <p className="font-medium text-slate-800">{item.createdBy.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatRoleLabel(item.createdBy.role)}</p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ResourcesPanel({
  resources,
  canMutate,
  onAssign,
}: Readonly<{
  resources: UnassignedSupervisor[];
  canMutate: boolean;
  onAssign: (resourceId: string) => void;
}>) {
  const [resourceSearch, setResourceSearch] = useState('');
  const filteredResources = filterAssignableResources(resources, resourceSearch);

  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Ressources assignables</h2>
          <p className="mt-1 text-sm text-slate-600">Disponibilite indicative sur la date selectionnee.</p>
        </div>
        <Badge tone="info">{resources.length}</Badge>
      </div>
      {resources.length > 4 ? (
        <div className="mt-4">
          <input
            className={filterClassName}
            onChange={(event) => setResourceSearch(event.target.value)}
            placeholder="Rechercher une ressource par nom, email ou disponibilitÃ©..."
            type="search"
            value={resourceSearch}
          />
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filteredResources.map((resource) => (
          <article className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4" key={resource.id}>
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-950">
                <Link
                  className="underline-offset-4 hover:text-orange-700 hover:underline"
                  href={`/web/users/${encodeURIComponent(resource.id)}/assignments-history`}
                >
                  {resource.firstName} {resource.name}
                </Link>
              </p>
              <p className="truncate text-sm text-slate-600">{resource.email}</p>
              <p className="mt-1 text-xs font-semibold text-orange-700">{resource.availabilityLabel}</p>
            </div>
            {canMutate ? (
              <button className={buttonClassName} onClick={() => onAssign(resource.id)} type="button">
                Assigner
              </button>
            ) : null}
          </article>
        ))}
        {filteredResources.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-500 md:col-span-2 xl:col-span-3">
            Aucune ressource ne correspond Ã  cette recherche.
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AssignmentDrawer({
  mode,
  form,
  projects,
  sites,
  resources,
  conflicts,
  canEditIdentity,
  isSubmitting,
  onChange,
  onCancel,
  onSubmit,
}: Readonly<{
  mode: DrawerMode;
  form: AssignmentFormState;
  projects: { id: string; name: string }[];
  sites: AvailableSite[];
  resources: UnassignedSupervisor[];
  conflicts: CentralizedPlanningAssignment[];
  canEditIdentity: boolean;
  isSubmitting: boolean;
  onChange: (form: AssignmentFormState) => void;
  onCancel: () => void;
  onSubmit: () => void;
}>) {
  const [resourceSearch, setResourceSearch] = useState('');
  const filteredSites = sites.filter((site) => !form.projectId || site.project.id === form.projectId);
  const filteredResources = filterAssignableResources(resources, resourceSearch);
  const selectedResource = resources.find((resource) => resource.id === form.supervisorId);
  const displayedResources =
    selectedResource && !filteredResources.some((resource) => resource.id === selectedResource.id)
      ? [selectedResource, ...filteredResources]
      : filteredResources;
  const progressNumber = form.targetProgress === '' ? null : Number(form.targetProgress);
  const quantityNumber = form.targetQuantity === '' ? null : Number(form.targetQuantity);
  const hasQuantityObjective = quantityNumber !== null && quantityNumber > 0;
  const isFreeMission = form.workLocationType === PlanningWorkLocationType.FREE_MISSION;
  const progressValid = progressNumber === null || (Number.isInteger(progressNumber) && progressNumber >= 0 && progressNumber <= 100);
  const quantityValid = quantityNumber === null || (Number.isFinite(quantityNumber) && quantityNumber >= 0);
  const canSubmit = Boolean(form.action.trim() && form.date) && progressValid && quantityValid;
  const createIdentityValid = mode === 'edit' || Boolean(form.supervisorId && (isFreeMission ? form.projectId : form.siteId));

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50">
      <aside className="fixed inset-y-0 right-0 flex w-full max-w-xl flex-col bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
        <div className="border-b border-slate-200 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
            {mode === 'create' ? 'Nouvelle tÃ¢che' : 'Modifier tÃ¢che'}
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">Planning terrain</h2>
        </div>
        <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto p-6">
          <Field label="Date">
            <input
              className={filterClassName}
              disabled={!canEditIdentity}
              onChange={(event) => onChange({ ...form, date: event.target.value })}
              type="date"
              value={form.date}
            />
          </Field>
          <Field label="Type de tÃ¢che">
            <select
              className={filterClassName}
              onChange={(event) => {
                const workLocationType = event.target.value as PlanningWorkLocationType;
                onChange({
                  ...form,
                  workLocationType,
                  siteId: workLocationType === PlanningWorkLocationType.FREE_MISSION ? '' : form.siteId,
                });
              }}
              value={form.workLocationType}
            >
              {Object.values(PlanningWorkLocationType).map((type) => (
                <option key={type} value={type}>
                  {workLocationTypeLabel[type]}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs font-semibold text-slate-500">
              Choisis d&apos;abord le type : il determine si la tache demande un chantier, une mission libre ou seulement une action bureau.
            </p>
          </Field>
          <Field label="Ressource">
            {resources.length > 4 ? (
              <input
                className={`${filterClassName} mb-2`}
                disabled={!canEditIdentity}
                onChange={(event) => {
                  const value = event.target.value;
                  setResourceSearch(value);
                  const nextResources = filterAssignableResources(resources, value);
                  const nextResource = nextResources[0];
                  if (nextResources.length === 1 && nextResource) {
                    onChange({ ...form, supervisorId: nextResource.id });
                  }
                }}
                placeholder="Rechercher une ressource..."
                type="search"
                value={resourceSearch}
              />
            ) : null}
            {resources.length > 4 && resourceSearch.trim() ? (
              <div className="mb-2 max-h-44 space-y-1 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-2">
                {filteredResources.length === 0 ? (
                  <p className="px-3 py-2 text-xs font-semibold text-slate-500">Aucune ressource trouvÃ©e.</p>
                ) : (
                  filteredResources.slice(0, 8).map((resource) => (
                    <button
                      className={`w-full rounded-xl px-3 py-2 text-left text-xs font-semibold transition ${
                        form.supervisorId === resource.id
                          ? 'bg-slate-950 text-white'
                          : 'bg-white text-slate-700 hover:bg-slate-100'
                      }`}
                      disabled={!canEditIdentity}
                      key={resource.id}
                      onClick={() => {
                        onChange({ ...form, supervisorId: resource.id });
                        setResourceSearch(`${resource.firstName} ${resource.name}`);
                      }}
                      type="button"
                    >
                      <span className="block">
                        {resource.firstName} {resource.name}
                      </span>
                      <span className={`block ${form.supervisorId === resource.id ? 'text-slate-200' : 'text-slate-500'}`}>
                        {resource.availabilityLabel}
                      </span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
            <select
              className={filterClassName}
              disabled={!canEditIdentity}
              onChange={(event) => onChange({ ...form, supervisorId: event.target.value })}
              value={form.supervisorId}
            >
              <option value="">Selectionner</option>
              {displayedResources.length === 0 ? (
                <option value="" disabled>
                  Aucune ressource ne correspond Ã  la recherche
                </option>
              ) : null}
              {displayedResources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.firstName} {resource.name} - {resource.availabilityLabel}
                </option>
              ))}
            </select>
            {conflicts.length > 0 ? (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-bold">Cette ressource est deja occupee ailleurs ce jour.</p>
                <ul className="mt-2 space-y-1">
                  {conflicts.slice(0, 3).map((conflict) => (
                    <li key={conflict.id}>
                      {conflict.projectName} - {conflict.siteName} : {conflict.action}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Field>
          <Field label="Projet">
            <select
              className={filterClassName}
              disabled={!canEditIdentity}
              onChange={(event) => onChange({ ...form, projectId: event.target.value, siteId: '' })}
              value={form.projectId}
            >
              <option value="">Tous les projets</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </Field>
          {!isFreeMission ? (
            <Field label="Chantier">
              <select
                className={filterClassName}
                disabled={!canEditIdentity}
                onChange={(event) => onChange({ ...form, siteId: event.target.value })}
                value={form.siteId}
              >
                <option value="">Selectionner</option>
                {filteredSites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name} - {site.project.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <div className="rounded-2xl border border-orange-100 bg-orange-50 p-3 text-xs font-semibold text-orange-800">
              Mission sans chantier fixe : la ressource pointera avec sa position GPS reelle.
            </div>
          )}
          <Field label="TÃ¢che Ã  rÃ©aliser">
            <textarea
              className={`${filterClassName} min-h-32`}
              onChange={(event) => onChange({ ...form, action: event.target.value })}
              value={form.action}
            />
          </Field>
          {!isFreeMission ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <Field label="Objectif quantitatif">
              <input
                className={filterClassName}
                min={0}
                onChange={(event) => {
                  const targetQuantity = event.target.value;
                  const nextQuantity = targetQuantity === '' ? null : Number(targetQuantity);
                  onChange({
                    ...form,
                    targetQuantity,
                    targetProgress: nextQuantity !== null && nextQuantity > 0 ? '' : form.targetProgress,
                  });
                }}
                placeholder="Ex : 12"
                step="0.01"
                type="number"
                value={form.targetQuantity}
              />
              {!quantityValid ? <p className="mt-2 text-xs font-semibold text-red-600">La quantite doit etre positive.</p> : null}
            </Field>
            <Field label="Unite">
              <input
                className={filterClassName}
                onChange={(event) => onChange({ ...form, targetUnit: event.target.value })}
                placeholder="u, m, ml..."
                value={form.targetUnit}
              />
            </Field>
          </div>
          ) : null}
          {!isFreeMission && hasQuantityObjective ? (
            <div className="rounded-2xl border border-sky-100 bg-sky-50 p-3 text-xs font-semibold text-sky-800">
              La progression sera calculee depuis la quantite realisee. La progression cible % est ignoree pour cette tache.
            </div>
          ) : !isFreeMission ? (
            <Field label="Progression cible % (si pas de quantite)">
              <input
                className={filterClassName}
                max={100}
                min={0}
                onChange={(event) => onChange({ ...form, targetProgress: event.target.value })}
                type="number"
                value={form.targetProgress}
              />
              <p className="mt-2 text-xs font-semibold text-slate-500">
                Uniquement pour les taches sans objectif quantitatif.
              </p>
              {!progressValid ? <p className="mt-2 text-xs font-semibold text-red-600">La progression doit etre entre 0 et 100.</p> : null}
            </Field>
          ) : null}
          <Field label="Consigne / objectif texte (facultatif)">
            <textarea
              className={`${filterClassName} min-h-24`}
              onChange={(event) => onChange({ ...form, objectiveText: event.target.value })}
              placeholder="Ex : finaliser les reprises, preparer le PV, suivre les validations..."
              value={form.objectiveText}
            />
            <p className="mt-2 text-xs font-semibold text-slate-500">
              Precision libre pour expliquer le travail attendu. Ce champ ne calcule pas la progression.
            </p>
          </Field>
          {mode === 'edit' ? (
            <Field label="Statut">
              <select
                className={filterClassName}
                onChange={(event) => onChange({ ...form, status: event.target.value as PlanningAssignmentStatus })}
                value={form.status}
              >
                {Object.values(PlanningAssignmentStatus).map((status) => (
                  <option key={status} value={status}>
                    {planningStatusLabel[status]}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-200 p-6">
          <button className={buttonClassName} onClick={onCancel} type="button">
            Annuler
          </button>
          <button
            className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
            disabled={!canSubmit || !progressValid || !createIdentityValid || isSubmitting}
            onClick={onSubmit}
            type="button"
          >
            {isSubmitting ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </aside>
    </div>
  );
}

function ConfirmDeleteModal({
  assignment,
  isDeleting,
  onCancel,
  onConfirm,
}: Readonly<{
  assignment: PlanningWebAssignment;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <section className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-panel">
        <h2 className="text-xl font-semibold text-slate-950">Supprimer cette tÃ¢che ?</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          La tÃ¢che de {assignment.supervisorFirstName} {assignment.supervisorName} sur {assignment.siteName} sera retirÃ©e.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button className={buttonClassName} onClick={onCancel} type="button">
            Annuler
          </button>
          <button
            className="rounded-2xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
            disabled={isDeleting}
            onClick={onConfirm}
            type="button"
          >
            {isDeleting ? 'Suppression...' : 'Supprimer'}
          </button>
        </div>
      </section>
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

function SegmentedButton({ active, onClick, children }: Readonly<{ active: boolean; onClick: () => void; children: ReactNode }>) {
  return (
    <button
      className={`rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${
        active ? 'bg-slate-950 text-white' : 'border border-slate-200 text-slate-700 hover:bg-slate-50'
      }`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function MetricCard({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <article className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-slate-950">{value}</p>
    </article>
  );
}

function ProgressValue({ value }: Readonly<{ value: number | null }>) {
  if (value === null) return <span className="text-slate-400">n/a</span>;

  return (
    <div className="w-full min-w-32">
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      <p className="mt-1 text-xs font-semibold text-slate-600">{value}%</p>
    </div>
  );
}

function CentralizedProgressSummary({ assignment }: Readonly<{ assignment: CentralizedPlanningAssignment }>) {
  const hasQuantityObjective = assignment.targetQuantity !== null && assignment.targetQuantity > 0;
  const progressValue = Math.max(0, Math.min(100, assignment.actualProgress ?? 0));
  const unit = assignment.targetUnit ? ` ${assignment.targetUnit}` : '';
  const hasDeclaredProgress = assignment.actualProgress !== null || assignment.actualQuantity !== null;

  return (
    <div className="min-w-40 space-y-2">
      <div className="flex items-center gap-3">
        <div className="h-2 min-w-28 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-orange-500" style={{ width: `${progressValue}%` }} />
        </div>
        <span className="w-10 text-xs font-bold text-slate-700">{progressValue}%</span>
      </div>

      {hasQuantityObjective ? (
        <p className="text-xs font-semibold text-slate-600">
          {formatQuantity(assignment.actualQuantity) ?? '0'} / {formatQuantity(assignment.targetQuantity)}
          {unit}
          {assignment.remainingQuantity !== null && assignment.remainingQuantity > 0
            ? ` - reste ${formatQuantity(assignment.remainingQuantity)}${unit}`
            : assignment.actualQuantity !== null
              ? ' - objectif atteint'
              : ''}
        </p>
      ) : assignment.targetProgress !== null ? (
        <p className="text-xs font-semibold text-slate-500">Cible {assignment.targetProgress}%</p>
      ) : null}

      {!hasDeclaredProgress ? <p className="text-xs font-semibold text-slate-400">Aucun avancement declare</p> : null}
      {assignment.latestProgressUpdate?.comment ? (
        <p className="line-clamp-2 text-xs text-slate-500">{assignment.latestProgressUpdate.comment}</p>
      ) : null}
    </div>
  );
}

function CentralizedStatusBadge({ item }: Readonly<{ item: CentralizedPlanningAssignment }>) {
  if (item.objectiveStatus === 'BLOCKED' || item.objectiveStatus === 'ACHIEVED') {
    const config = objectiveStatusConfig[item.objectiveStatus];
    return <Badge tone={config.tone}>{config.label}</Badge>;
  }

  return <Badge tone={statusTone(item.status)}>{planningStatusLabel[item.status]}</Badge>;
}

function ObjectiveProgressCard({
  assignment,
}: Readonly<{
  assignment: Pick<
    PlanningWebAssignment,
    | 'targetProgress'
    | 'targetQuantity'
    | 'targetUnit'
    | 'actualQuantity'
    | 'remainingQuantity'
    | 'actualProgress'
    | 'progressDelta'
    | 'objectiveStatus'
    | 'latestProgressUpdate'
  >;
}>) {
  const config = objectiveStatusConfig[assignment.objectiveStatus];
  const hasQuantityObjective = assignment.targetQuantity !== null && assignment.targetQuantity > 0;
  const actualProgress = assignment.actualProgress ?? assignment.targetProgress;
  const unit = assignment.targetUnit ? ` ${assignment.targetUnit}` : '';
  const actualLabel = formatQuantity(assignment.actualQuantity) ?? '0';
  const targetLabel = formatQuantity(assignment.targetQuantity);
  const remainingLabel =
    assignment.remainingQuantity === null
      ? null
      : assignment.remainingQuantity > 0
        ? `${formatQuantity(assignment.remainingQuantity)}${unit} restants`
        : 'Objectif atteint';

  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50/80 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge tone={config.tone}>{config.label}</Badge>
        {actualProgress !== null ? <span className="text-sm font-bold text-slate-900">{actualProgress}%</span> : null}
      </div>

      <div className="mt-3">
        <ProgressValue value={actualProgress} />
      </div>

      {hasQuantityObjective ? (
        <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
          <div>
            <p className="font-semibold uppercase tracking-[0.12em] text-slate-400">Objectif</p>
            <p className="mt-1 font-semibold text-slate-800">
              {targetLabel}
              {unit}
            </p>
          </div>
          <div>
            <p className="font-semibold uppercase tracking-[0.12em] text-slate-400">RÃ©alisÃ©</p>
            <p className="mt-1 font-semibold text-slate-800">
              {actualLabel} / {targetLabel}
              {unit}
            </p>
          </div>
          <div>
            <p className="font-semibold uppercase tracking-[0.12em] text-slate-400">Reste</p>
            <p className="mt-1 font-semibold text-slate-800">{remainingLabel ?? '-'}</p>
          </div>
        </div>
      ) : (
        <ObjectiveSummary assignment={assignment} />
      )}

      {assignment.progressDelta !== null ? (
        <p className="mt-2 text-xs font-semibold text-slate-500">
          Ecart {assignment.progressDelta >= 0 ? '+' : ''}
          {assignment.progressDelta}%
        </p>
      ) : null}
      {assignment.latestProgressUpdate?.comment ? (
        <p className="mt-2 line-clamp-2 text-xs text-slate-500">{assignment.latestProgressUpdate.comment}</p>
      ) : null}
    </div>
  );
}

function ObjectiveSummary({
  assignment,
}: Readonly<{
  assignment: Pick<
    PlanningWebAssignment,
    | 'targetQuantity'
    | 'targetUnit'
    | 'actualQuantity'
    | 'remainingQuantity'
    | 'actualProgress'
    | 'progressDelta'
    | 'objectiveStatus'
    | 'latestProgressUpdate'
  >;
}>) {
  const config = objectiveStatusConfig[assignment.objectiveStatus];
  const hasQuantityObjective = assignment.targetQuantity !== null && assignment.targetQuantity > 0;

  return (
    <div className="mt-2 space-y-1">
      <Badge tone={config.tone}>{config.label}</Badge>
      {hasQuantityObjective ? (
        <p className="text-xs font-semibold text-slate-600">
          Realise {formatQuantity(assignment.actualQuantity) ?? '0'} / {formatQuantity(assignment.targetQuantity)} {assignment.targetUnit ?? ''}
          {assignment.remainingQuantity !== null
            ? assignment.remainingQuantity > 0
              ? ` - reste ${formatQuantity(assignment.remainingQuantity)} ${assignment.targetUnit ?? ''}`
              : ' - objectif atteint'
            : ''}
        </p>
      ) : null}
      {assignment.actualProgress !== null ? (
        <p className="text-xs font-semibold text-slate-600">
          RÃ©el {assignment.actualProgress}%
          {assignment.progressDelta !== null ? ` (${assignment.progressDelta >= 0 ? '+' : ''}${assignment.progressDelta}%)` : ''}
        </p>
      ) : null}
      {assignment.latestProgressUpdate?.comment ? (
        <p className="line-clamp-2 text-xs text-slate-500">{assignment.latestProgressUpdate.comment}</p>
      ) : null}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="h-28 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
      <div className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
    </div>
  );
}

async function fetchPlanningDay(date: string) {
  const response = await authFetch(`/api/planning?date=${encodeURIComponent(date)}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de charger le planning.'));
  }
  return (await response.json()) as PlanningWebDayResponse;
}

async function fetchCentralizedPlanning(filters: CentralizedPlanningFilters) {
  const searchParams = new URLSearchParams();
  searchParams.set('from', filters.from);
  searchParams.set('to', filters.to);
  if (filters.projectId) searchParams.set('projectId', filters.projectId);
  if (filters.siteId) searchParams.set('siteId', filters.siteId);
  if (filters.resourceId) searchParams.set('resourceId', filters.resourceId);
  if (filters.role) searchParams.set('role', filters.role);
  if (filters.workLocationType) searchParams.set('workLocationType', filters.workLocationType);

  const response = await authFetch(`/api/planning/centralized?${searchParams.toString()}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de charger le planning centralisÃ©.'));
  }

  return (await response.json()) as CentralizedPlanningResponse;
}

async function createAssignment(data: PlanningWebCreateRequest) {
  const response = await authFetch('/api/planning/assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de crÃ©er la tÃ¢che.'));
  }
  return (await response.json()) as PlanningWebMutationResponse;
}

async function updateAssignment(id: string, data: PlanningWebUpdateRequest) {
  const response = await authFetch(`/api/planning/assignments/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de modifier la tÃ¢che.'));
  }
  return (await response.json()) as PlanningWebMutationResponse;
}

async function createFreeMission(data: FreeMissionWebRequest) {
  const response = await authFetch('/api/free-missions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de creer la mission libre.'));
  }
  return (await response.json()) as unknown;
}

async function updateFreeMission(id: string, data: FreeMissionWebRequest) {
  const response = await authFetch(`/api/free-missions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de modifier la mission libre.'));
  }
  return (await response.json()) as unknown;
}

async function deleteAssignment(id: string) {
  const response = await authFetch(`/api/planning/assignments/${id}`, { method: 'DELETE' });
  if (response.status === 404) {
    const freeMissionResponse = await authFetch(`/api/free-missions/${id}`, { method: 'DELETE' });
    if (!freeMissionResponse.ok) {
      throw new Error(await getApiErrorMessage(freeMissionResponse, 'Impossible de supprimer la mission libre.'));
    }
    return;
  }
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de supprimer la tÃ¢che.'));
  }
}

async function downloadPlanningExport(
  date: string,
  filters: PlanningWebFilters,
  format: 'xlsx' | 'pdf',
  onError: (error: unknown, title: string) => void,
) {
  try {
    const searchParams = new URLSearchParams({ date, format });
    if (filters.projectId) searchParams.set('projectId', filters.projectId);
    if (filters.siteId) searchParams.set('siteId', filters.siteId);
    if (filters.resourceId) searchParams.set('resourceId', filters.resourceId);

    const response = await authFetch(`/api/planning/export?${searchParams.toString()}`, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(await getApiErrorMessage(response, 'Export planning impossible.'));
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = extractFileName(response.headers.get('content-disposition')) ?? `recap-planning-${date}.${format}`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    onError(error, 'Export impossible');
  }
}

async function getApiErrorMessage(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { message?: string };
    return payload.message ?? fallback;
  } catch {
    return fallback;
  }
}

function extractFileName(contentDisposition: string | null) {
  const match = contentDisposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? null;
}

function filterAssignments(assignments: PlanningWebAssignment[], sites: AvailableSite[], filters: PlanningWebFilters) {
  return assignments.filter((assignment) => {
    const site = sites.find((item) => item.id === assignment.siteId);
    const projectId = assignment.projectId ?? site?.project.id;
    return (
      (!filters.projectId || projectId === filters.projectId) &&
      (!filters.siteId || assignment.siteId === filters.siteId) &&
      (!filters.resourceId || assignment.supervisorId === filters.resourceId)
    );
  });
}

function groupAssignmentsByResource(assignments: PlanningWebAssignment[]): PlanningAssignmentGroup[] {
  const groups = new Map<string, PlanningAssignmentGroup>();

  for (const assignment of assignments) {
    const existing = groups.get(assignment.supervisorId);

    if (existing) {
      existing.assignments.push(assignment);
      continue;
    }

    groups.set(assignment.supervisorId, {
      supervisorId: assignment.supervisorId,
      supervisorFirstName: assignment.supervisorFirstName,
      supervisorName: assignment.supervisorName,
      assignments: [assignment],
    });
  }

  return [...groups.values()];
}

function getProjectOptions(sites: AvailableSite[]) {
  const projects = new Map<string, string>();
  sites.forEach((site) => projects.set(site.project.id, site.project.name));
  return [...projects.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getCentralizedOptions(items: CentralizedPlanningAssignment[]) {
  const projects = new Map<string, string>();
  const sites = new Map<string, { id: string; name: string; projectId: string }>();
  const resources = new Map<string, string>();
  const roles = new Set<Role>();

  for (const item of items) {
    projects.set(item.projectId, item.projectName);
    sites.set(item.siteId, { id: item.siteId, name: item.siteName, projectId: item.projectId });
    resources.set(item.resourceId, item.resourceName);
    roles.add(item.resourceRole);
  }

  return {
    projects: [...projects.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    sites: [...sites.values()].sort((a, b) => a.name.localeCompare(b.name)),
    resources: [...resources.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    roles: [...roles.values()].sort((a, b) => formatRoleLabel(a).localeCompare(formatRoleLabel(b))),
  };
}

function filterAssignableResources(resources: UnassignedSupervisor[], search: string) {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) {
    return resources;
  }

  return resources.filter((resource) =>
    `${resource.firstName} ${resource.name} ${resource.email} ${resource.availabilityLabel}`
      .toLowerCase()
      .includes(normalizedSearch),
  );
}

function createEmptyForm(date: string): AssignmentFormState {
  return {
    supervisorId: '',
    projectId: '',
    siteId: '',
    date,
    action: '',
    targetProgress: '',
    targetQuantity: '',
    targetUnit: '',
    objectiveText: '',
    status: PlanningAssignmentStatus.ASSIGNED,
    workLocationType: PlanningWorkLocationType.ON_SITE,
  };
}

function formatQuantity(value: number | null) {
  if (value === null) return null;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function statusTone(status: PlanningAssignmentStatus) {
  if (status === PlanningAssignmentStatus.COMPLETED) return 'success';
  if (status === PlanningAssignmentStatus.IN_PROGRESS) return 'info';
  if (status === PlanningAssignmentStatus.CANCELLED) return 'error';
  return 'warning';
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDateKey(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function getWeekDates(dateKey: string) {
  const date = parseDateKey(dateKey);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = addDays(date, mondayOffset);
  return Array.from({ length: 7 }, (_, index) => formatDateKey(addDays(monday, index)));
}

function formatLongDate(date: Date) {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

function formatWeekday(date: Date) {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(date);
}
