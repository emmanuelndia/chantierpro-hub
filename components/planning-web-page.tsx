'use client';

import Link from 'next/link';
import { PlanningAssignmentStatus, type Role } from '@prisma/client';
import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import type {
  PlanningWebAssignment,
  PlanningWebCreateRequest,
  PlanningWebDayResponse,
  PlanningWebDuplicateResponse,
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

type AssignmentFormState = {
  id?: string;
  supervisorId: string;
  projectId: string;
  siteId: string;
  date: string;
  action: string;
  targetProgress: string;
  status: PlanningAssignmentStatus;
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

export function PlanningWebPage({ viewer }: PlanningWebPageProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [viewMode, setViewMode] = useState<ViewMode>('day');
  const [filters, setFilters] = useState<PlanningWebFilters>({ projectId: '', siteId: '', resourceId: '' });
  const [drawerMode, setDrawerMode] = useState<DrawerMode | null>(null);
  const [form, setForm] = useState<AssignmentFormState>(() => createEmptyForm(selectedDate));
  const [deleteTarget, setDeleteTarget] = useState<PlanningWebAssignment | null>(null);
  const canMutate = viewer.role === 'GENERAL_SUPERVISOR' || viewer.role === 'PROJECT_MANAGER';

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
      pushToast({ type: 'success', title: 'Assignation creee' });
      closeDrawer();
      await queryClient.invalidateQueries({ queryKey: ['web-planning'] });
    },
    onError: (error) => pushMutationError(error, "Creation impossible"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PlanningWebUpdateRequest }) => updateAssignment(id, data),
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Assignation modifiee' });
      closeDrawer();
      await queryClient.invalidateQueries({ queryKey: ['web-planning'] });
    },
    onError: (error) => pushMutationError(error, 'Modification impossible'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAssignment,
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Assignation supprimee' });
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['web-planning'] });
    },
    onError: (error) => pushMutationError(error, 'Suppression impossible'),
  });

  const duplicateMutation = useMutation({
    mutationFn: duplicatePlanning,
    onSuccess: async (payload, variables) => {
      pushToast({
        type: 'success',
        title: 'Planning duplique',
        message: `${payload.createdCount} assignation(s) creee(s), ${payload.skippedCount} ignoree(s).`,
      });
      setSelectedDate(variables.targetDate);
      await queryClient.invalidateQueries({ queryKey: ['web-planning'] });
    },
    onError: (error) => pushMutationError(error, 'Duplication impossible'),
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
  const isMutating = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending || duplicateMutation.isPending;

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
        },
      });
    }
  }

  function duplicateToTomorrow() {
    const targetDate = formatDateKey(addDays(selectedDateObject, 1));
    duplicateMutation.mutate({ sourceDate: selectedDate, targetDate });
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
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Assignations journalieres</h1>
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
          <MetricCard label="Assignations" value={data.assignments.length} />
          <MetricCard label="Ressources actives" value={data.unassignedSupervisors.length} />
          <MetricCard label="Chantiers accessibles" value={data.availableSites.length} />
          <MetricCard label="Affichees" value={filteredAssignments.length} />
        </section>
      ) : null}

      {canMutate && data ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Actions planning</h2>
            <p className="mt-1 text-sm text-slate-600">Cree une assignation ou copie le planning vers demain.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60" disabled={isMutating} onClick={() => openCreate()} type="button">
              Ajouter une assignation
            </button>
            <button className={buttonClassName} disabled={isMutating || data.assignments.length === 0} onClick={duplicateToTomorrow} type="button">
              {duplicateMutation.isPending ? 'Duplication...' : 'Dupliquer vers demain'}
            </button>
          </div>
        </section>
      ) : null}

      {dayQuery.isError ? (
        <EmptyState title="Planning indisponible" description="Le planning n'a pas pu etre charge. Verifie ta session puis reessaie." />
      ) : null}

      {dayQuery.isLoading ? <LoadingState /> : null}

      {data && viewMode === 'day' ? (
        <DayPlanningTable
          assignments={filteredAssignments}
          canMutate={canMutate}
          sites={sites}
          onDelete={setDeleteTarget}
          onEdit={openEdit}
        />
      ) : null}

      {data && viewMode === 'week' ? <WeekPlanningGrid dates={weekDates} filters={filters} queries={weekQueries} /> : null}

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

function DayPlanningTable({
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
    return <EmptyState title="Aucune assignation" description="Aucune ligne ne correspond aux filtres selectionnes." />;
  }

  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-panel">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="px-4 py-4">Ressource</th>
              <th className="px-4 py-4">Poste</th>
              <th className="px-4 py-4">Projet</th>
              <th className="px-4 py-4">Chantier</th>
              <th className="px-4 py-4">Action du jour</th>
              <th className="px-4 py-4">Progression</th>
              <th className="px-4 py-4">Statut</th>
              {canMutate ? <th className="px-4 py-4">Actions</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {assignments.map((assignment) => {
              const site = sites.find((item) => item.id === assignment.siteId);
              return (
                <tr className="align-top" key={assignment.id}>
                  <td className="px-4 py-4">
                    <Link
                      className="font-semibold text-slate-950 underline-offset-4 hover:text-orange-700 hover:underline"
                      href={`/web/users/${encodeURIComponent(assignment.supervisorId)}/assignments-history`}
                    >
                      {assignment.supervisorFirstName} {assignment.supervisorName}
                    </Link>
                    <p className="text-xs text-slate-500">{assignment.supervisorId}</p>
                  </td>
                  <td className="px-4 py-4 text-slate-700">Ressource terrain</td>
                  <td className="px-4 py-4 text-slate-700">{site?.project.name ?? '-'}</td>
                  <td className="px-4 py-4">
                    <p className="font-semibold text-slate-800">{assignment.siteName}</p>
                    <p className="text-xs text-slate-500">{assignment.siteAddress}</p>
                  </td>
                  <td className="max-w-xs px-4 py-4 text-slate-700">{assignment.action}</td>
                  <td className="px-4 py-4">
                    <ProgressValue value={assignment.targetProgress} />
                  </td>
                  <td className="px-4 py-4">
                    <Badge tone={statusTone(assignment.status)}>{planningStatusLabel[assignment.status]}</Badge>
                  </td>
                  {canMutate ? (
                    <td className="px-4 py-4">
                      <div className="flex min-w-40 flex-wrap gap-2">
                        <button className={buttonClassName} onClick={() => onEdit(assignment)} type="button">
                          Modifier
                        </button>
                        <button className="rounded-2xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-50" onClick={() => onDelete(assignment)} type="button">
                          Supprimer
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WeekPlanningGrid({
  dates,
  filters,
  queries,
}: Readonly<{
  dates: string[];
  filters: PlanningWebFilters;
  queries: UseQueryResult<PlanningWebDayResponse>[];
}>) {
  return (
    <section className="grid gap-4 xl:grid-cols-7">
      {dates.map((date, index) => {
        const query = queries[index];
        if (!query) return null;
        const assignments = filterAssignments(query.data?.assignments ?? [], query.data?.availableSites ?? [], filters);
        return (
          <article className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-panel" key={date}>
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
                </div>
              ))}
              {!query.isLoading && assignments.length === 0 ? <p className="text-sm text-slate-500">Aucune assignation</p> : null}
              {assignments.length > 4 ? <p className="text-xs font-semibold text-slate-500">+{assignments.length - 4} autre(s)</p> : null}
            </div>
          </article>
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
            {mode === 'create' ? 'Nouvelle assignation' : 'Modifier assignation'}
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
          <Field label="Action du jour">
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
        <h2 className="text-xl font-semibold text-slate-950">Supprimer cette assignation ?</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {assignment.supervisorFirstName} {assignment.supervisorName} ne sera plus assigne sur {assignment.siteName}.
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
    throw new Error(await getApiErrorMessage(response, "Impossible de creer l'assignation."));
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
    throw new Error(await getApiErrorMessage(response, "Impossible de modifier l'assignation."));
  }
  return (await response.json()) as PlanningWebMutationResponse;
}

async function deleteAssignment(id: string) {
  const response = await authFetch(`/api/planning/assignments/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, "Impossible de supprimer l'assignation."));
  }
}

async function duplicatePlanning(data: { sourceDate: string; targetDate: string }) {
  const response = await authFetch('/api/planning/duplicate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de dupliquer le planning.'));
  }
  return (await response.json()) as PlanningWebDuplicateResponse;
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
