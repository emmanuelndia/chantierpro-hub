'use client';

import Link from 'next/link';
import { PlanningAssignmentStatus, PlanningWorkLocationType, type Role } from '@prisma/client';
import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { TableActionsMenu } from '@/components/table-actions-menu';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import type {
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

type ViewMode = 'day' | 'week';
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
  status: PlanningAssignmentStatus;
  workLocationType: PlanningWorkLocationType;
};

const todayKey = formatDateKey(new Date());
const filterClassName =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-500';
const buttonClassName =
  'rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

const planningStatusLabel: Record<PlanningAssignmentStatus, string> = {
  ASSIGNED: 'Non demarre',
  IN_PROGRESS: 'En cours',
  COMPLETED: 'Termine',
  CANCELLED: 'Annule',
};

const workLocationTypeLabel: Record<PlanningWorkLocationType, string> = {
  ON_SITE: 'Presence chantier requise',
  OFFICE: 'Tache bureau / coordination',
};

export function PlanningWebPage({ viewer }: PlanningWebPageProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [filters, setFilters] = useState<PlanningWebFilters>({ projectId: '', siteId: '', resourceId: '' });
  const [drawerMode, setDrawerMode] = useState<DrawerMode | null>(null);
  const [form, setForm] = useState<AssignmentFormState>(() => createEmptyForm(selectedDate));
  const [deleteTarget, setDeleteTarget] = useState<PlanningWebAssignment | null>(null);
  const canMutate = viewer.role === 'GENERAL_SUPERVISOR' || viewer.role === 'BE_MANAGER' || viewer.role === 'PROJECT_MANAGER';

  const dayQuery = useQuery({
    queryKey: ['web-planning', selectedDate],
    queryFn: () => fetchPlanningDay(selectedDate),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
  const weekQueries = useQueries({
    queries: weekDates.map((date) => ({
      queryKey: ['web-planning', date],
      queryFn: () => fetchPlanningDay(date),
      enabled: viewMode === 'week',
      staleTime: 30_000,
    })),
  });

  const createMutation = useMutation({
    mutationFn: createAssignment,
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Tâche créée' });
      closeDrawer();
      await queryClient.invalidateQueries({ queryKey: ['web-planning'] });
    },
    onError: (error) => pushMutationError(error, "Creation impossible"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PlanningWebUpdateRequest }) => updateAssignment(id, data),
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Tâche modifiée' });
      closeDrawer();
      await queryClient.invalidateQueries({ queryKey: ['web-planning'] });
    },
    onError: (error) => pushMutationError(error, 'Modification impossible'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAssignment,
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Tâche supprimée' });
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
  const selectedDateObject = parseDateKey(selectedDate);
  const isMutating = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  function setFilter(key: keyof PlanningWebFilters, value: string) {
    setFilters((current) => ({
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
      projectId: sites.find((site) => site.id === assignment.siteId)?.project.id ?? '',
      siteId: assignment.siteId,
      date: selectedDate,
      action: assignment.action,
      targetProgress: assignment.targetProgress === null ? '' : String(assignment.targetProgress),
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

    if (drawerMode === 'create') {
      const payload: PlanningWebCreateRequest = {
        supervisorId: form.supervisorId,
        siteId: form.siteId,
        action: form.action,
        targetProgress,
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
          targetProgress,
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
      message: error instanceof Error ? error.message : 'Operation refusee.',
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">Planning terrain</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Tâches journalières</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Planifie les ressources terrain par chantier, avec consultation jour ou semaine.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={dayQuery.isFetching ? 'warning' : 'info'}>
              {dayQuery.isFetching ? 'Actualisation...' : formatLongDate(selectedDateObject)}
            </Badge>
            {!canMutate ? <Badge tone="neutral">Lecture seule</Badge> : null}
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
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
          </div>
        </div>
      </section>

      {data ? (
        <section className="grid gap-4 md:grid-cols-4">
          <MetricCard label="Tâches" value={data.assignments.length} />
          <MetricCard label="Ressources actives" value={data.unassignedSupervisors.length} />
          <MetricCard label="Chantiers accessibles" value={data.availableSites.length} />
          <MetricCard label="Affichees" value={filteredAssignments.length} />
        </section>
      ) : null}

      {canMutate && data ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Actions planning</h2>
            <p className="mt-1 text-sm text-slate-600">Crée une tâche pour une ressource terrain.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60" disabled={isMutating} onClick={() => openCreate()} type="button">
              Ajouter une tâche
            </button>
          </div>
        </section>
      ) : null}

      {dayQuery.isError ? (
        <EmptyState title="Planning indisponible" description="Le planning n'a pas pu etre charge. Verifie ta session puis reessaie." />
      ) : null}

      {dayQuery.isLoading ? <LoadingState /> : null}

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

      {data ? (
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
    return <EmptyState title="Aucune tâche" description="Aucune ligne ne correspond aux filtres sélectionnés." />;
  }

  const groups = groupAssignmentsByResource(assignments);

  return (
    <section className="space-y-4">
      {groups.map((group) => (
        <article className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-panel" key={group.supervisorId}>
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Link
                className="text-lg font-semibold text-slate-950 underline-offset-4 hover:text-orange-700 hover:underline"
                href={`/web/users/${encodeURIComponent(group.supervisorId)}/assignments-history`}
              >
                {group.supervisorFirstName} {group.supervisorName}
              </Link>
              <p className="mt-1 text-sm text-slate-500">Ressource terrain</p>
            </div>
            <Badge tone="info">{group.assignments.length} tâche(s)</Badge>
          </div>

          <div className="divide-y divide-slate-100">
            {group.assignments.map((assignment) => {
              const site = sites.find((item) => item.id === assignment.siteId);
              return (
                <div
                  className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(8rem,0.8fr)_minmax(12rem,1.1fr)_minmax(12rem,1.2fr)_10rem_9rem_auto] md:items-center"
                  key={assignment.id}
                >
                  <PlanningTaskField label="Projet">
                    <p className="font-medium text-slate-800">{site?.project.name ?? '-'}</p>
                  </PlanningTaskField>
                  <PlanningTaskField label="Chantier">
                    <p className="font-semibold text-slate-800">{assignment.siteName}</p>
                    <p className="text-xs text-slate-500">{assignment.siteAddress}</p>
                  </PlanningTaskField>
                  <PlanningTaskField label="Tâche">
                    <p className="text-slate-700">{assignment.action}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Cree par {assignment.createdBy.firstName} {assignment.createdBy.lastName}
                    </p>
                  </PlanningTaskField>
                  <PlanningTaskField label="Progression">
                    <ProgressValue value={assignment.targetProgress} />
                  </PlanningTaskField>
                  <PlanningTaskField label="Statut">
                    <div className="space-y-2">
                      <Badge tone={statusTone(assignment.status)}>{planningStatusLabel[assignment.status]}</Badge>
                      <Badge tone={assignment.workLocationType === 'OFFICE' ? 'neutral' : 'info'}>
                        {assignment.workLocationType === 'OFFICE' ? 'Bureau' : 'Terrain'}
                      </Badge>
                    </div>
                  </PlanningTaskField>
                  {canMutate ? (
                    <div className="flex justify-start md:justify-end">
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
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </article>
      ))}
    </section>
  );
}

function PlanningTaskField({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400 md:hidden">{label}</p>
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
              {!query.isLoading && assignments.length === 0 ? <p className="text-sm text-slate-500">Aucune tâche</p> : null}
              {assignments.length > 4 ? <p className="text-xs font-semibold text-slate-500">+{assignments.length - 4} autre(s)</p> : null}
            </div>
          </button>
        );
      })}
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
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Ressources assignables</h2>
          <p className="mt-1 text-sm text-slate-600">Disponibilite indicative sur la date selectionnee.</p>
        </div>
        <Badge tone="info">{resources.length}</Badge>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {resources.map((resource) => (
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
  canEditIdentity: boolean;
  isSubmitting: boolean;
  onChange: (form: AssignmentFormState) => void;
  onCancel: () => void;
  onSubmit: () => void;
}>) {
  const filteredSites = sites.filter((site) => !form.projectId || site.project.id === form.projectId);
  const progressNumber = form.targetProgress === '' ? null : Number(form.targetProgress);
  const progressValid = progressNumber === null || (Number.isInteger(progressNumber) && progressNumber >= 0 && progressNumber <= 100);
  const canSubmit = Boolean(form.action.trim() && form.date);
  const createIdentityValid = mode === 'edit' || Boolean(form.supervisorId && form.siteId);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50">
      <aside className="fixed inset-y-0 right-0 flex w-full max-w-xl flex-col bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
        <div className="border-b border-slate-200 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
            {mode === 'create' ? 'Nouvelle tâche' : 'Modifier tâche'}
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
          <Field label="Ressource">
            <select
              className={filterClassName}
              disabled={!canEditIdentity}
              onChange={(event) => onChange({ ...form, supervisorId: event.target.value })}
              value={form.supervisorId}
            >
              <option value="">Selectionner</option>
              {resources.map((resource) => (
                <option key={resource.id} value={resource.id}>
                  {resource.firstName} {resource.name} - {resource.availabilityLabel}
                </option>
              ))}
            </select>
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
          <Field label="Tâche à réaliser">
            <textarea
              className={`${filterClassName} min-h-32`}
              onChange={(event) => onChange({ ...form, action: event.target.value })}
              value={form.action}
            />
          </Field>
          <Field label="Progression cible %">
            <input
              className={filterClassName}
              max={100}
              min={0}
              onChange={(event) => onChange({ ...form, targetProgress: event.target.value })}
              type="number"
              value={form.targetProgress}
            />
            {!progressValid ? <p className="mt-2 text-xs font-semibold text-red-600">La progression doit etre entre 0 et 100.</p> : null}
          </Field>
          <Field label="Type de tÃ¢che">
            <select
              className={filterClassName}
              onChange={(event) => onChange({ ...form, workLocationType: event.target.value as PlanningWorkLocationType })}
              value={form.workLocationType}
            >
              {Object.values(PlanningWorkLocationType).map((type) => (
                <option key={type} value={type}>
                  {workLocationTypeLabel[type]}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs font-semibold text-slate-500">
              Une tÃ¢che bureau reste dans le planning, mais ne demande pas de pointage chantier.
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
        <h2 className="text-xl font-semibold text-slate-950">Supprimer cette tâche ?</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          La tâche de {assignment.supervisorFirstName} {assignment.supervisorName} sur {assignment.siteName} sera retirée.
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
    <div className="w-32">
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      <p className="mt-1 text-xs font-semibold text-slate-600">{value}%</p>
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

async function createAssignment(data: PlanningWebCreateRequest) {
  const response = await authFetch('/api/planning/assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de créer la tâche.'));
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
    throw new Error(await getApiErrorMessage(response, 'Impossible de modifier la tâche.'));
  }
  return (await response.json()) as PlanningWebMutationResponse;
}

async function deleteAssignment(id: string) {
  const response = await authFetch(`/api/planning/assignments/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de supprimer la tâche.'));
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

function filterAssignments(assignments: PlanningWebAssignment[], sites: AvailableSite[], filters: PlanningWebFilters) {
  return assignments.filter((assignment) => {
    const site = sites.find((item) => item.id === assignment.siteId);
    return (
      (!filters.projectId || site?.project.id === filters.projectId) &&
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

function createEmptyForm(date: string): AssignmentFormState {
  return {
    supervisorId: '',
    projectId: '',
    siteId: '',
    date,
    action: '',
    targetProgress: '',
    status: PlanningAssignmentStatus.ASSIGNED,
    workLocationType: PlanningWorkLocationType.ON_SITE,
  };
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
