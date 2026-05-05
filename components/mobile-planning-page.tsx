'use client';

import { PlanningAssignmentStatus } from '@prisma/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { authFetch } from '@/lib/auth/client-session';
import { getMobileOfflineCache, setMobileOfflineCache } from '@/lib/mobile-offline-db';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type {
  AvailableSite,
  CreateAssignmentRequest,
  DuplicateAssignmentsRequest,
  DuplicateAssignmentsResponse,
  PlanningAssignment,
  PlanningClockInStatus,
  PlanningAssignmentMutationResponse,
  PlanningDayResponse,
  UnassignedSupervisor,
  UpdateAssignmentRequest,
} from '@/types/mobile-planning';

type MobilePlanningPageProps = Readonly<{
  user: WebSessionUser;
}>;

const todayKey = formatDateKey(new Date());

export function MobilePlanningPage({ user }: MobilePlanningPageProps) {
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [showAddAssignment, setShowAddAssignment] = useState(false);
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateAssignmentRequest>(() => createEmptyForm(todayKey));
  const queryClient = useQueryClient();

  const planningQuery = useQuery({
    queryKey: ['mobile-planning', selectedDate],
    queryFn: async () => {
      const response = await authFetch(`/api/mobile/planning/${selectedDate}`);

      if (!response.ok) {
        const cached = await getMobileOfflineCache<PlanningDayResponse>(`planning-${selectedDate}`);
        if (cached) {
          return cached.payload;
        }
        
        // Lancer une erreur avec le statut pour une gestion spécifique
        const error = new Error(await getApiErrorMessage(response, 'Impossible de charger le planning.'));
        (error as any).status = response.status;
        throw error;
      }

      const payload = (await response.json()) as PlanningDayResponse;
      await setMobileOfflineCache(`planning-${selectedDate}`, payload, 24 * 60 * 60 * 1000);
      return payload;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const createAssignmentMutation = useMutation({
    mutationFn: async (data: CreateAssignmentRequest) => {
      const response = await authFetch('/api/mobile/planning/assignment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Impossible de créer l'assignation."));
      }

      return (await response.json()) as PlanningAssignmentMutationResponse;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mobile-planning'] });
      setShowAddAssignment(false);
      setFormData(createEmptyForm(selectedDate));
    },
  });

  const updateAssignmentMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateAssignmentRequest }) => {
      const response = await authFetch(`/api/mobile/planning/assignment/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Impossible de modifier l'assignation."));
      }

      return (await response.json()) as PlanningAssignmentMutationResponse;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mobile-planning'] });
      setEditingAssignmentId(null);
    },
  });

  const deleteAssignmentMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await authFetch(`/api/mobile/planning/assignment/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, "Impossible de retirer l'assignation."));
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mobile-planning'] });
      setEditingAssignmentId(null);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (data: DuplicateAssignmentsRequest) => {
      const response = await authFetch('/api/mobile/planning/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Impossible de dupliquer le planning.'));
      }

      return (await response.json()) as DuplicateAssignmentsResponse;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mobile-planning'] });
    },
  });

  const data = planningQuery.data;
  const selectedDateObject = parseDateKey(selectedDate);
  const mutationError =
    getMutationError(createAssignmentMutation.error) ??
    getMutationError(updateAssignmentMutation.error) ??
    getMutationError(deleteAssignmentMutation.error) ??
    getMutationError(duplicateMutation.error);

  function navigateDate(direction: 'prev' | 'next') {
    const nextDate = addDays(selectedDateObject, direction === 'prev' ? -1 : 1);
    const nextKey = formatDateKey(nextDate);
    setSelectedDate(nextKey);
    setFormData((prev) => ({ ...prev, date: nextKey }));
    setEditingAssignmentId(null);
  }

  function goToToday() {
    setSelectedDate(todayKey);
    setFormData((prev) => ({ ...prev, date: todayKey }));
    setEditingAssignmentId(null);
  }

  function openCreateForm(supervisorId?: string) {
    setFormData({
      ...createEmptyForm(selectedDate),
      supervisorId: supervisorId ?? '',
    });
    setShowAddAssignment(true);
  }

  function handleCreateAssignment() {
    if (!formData.supervisorId || !formData.siteId || !formData.action.trim()) {
      return;
    }
    createAssignmentMutation.mutate(formData);
  }

  function handleDuplicateFromYesterday() {
    duplicateMutation.mutate({
      sourceDate: formatDateKey(addDays(selectedDateObject, -1)),
      targetDate: selectedDate,
    });
  }

  return (
    <div className="space-y-5 pb-20">
      <section className="rounded-lg border border-sky-200 bg-sky-50 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700">Planning terrain</p>
        <h1 className="mt-1 text-xl font-black text-slate-950">Assignations du jour</h1>
        <p className="mt-1 text-sm text-slate-600">
          {user.firstName} {user.lastName}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <IconButton label="Jour précédent" onClick={() => navigateDate('prev')}>
            <ChevronLeftIcon className="h-5 w-5" />
          </IconButton>
          <div className="min-w-0 flex-1 text-center">
            <div className="text-base font-bold text-slate-950">{formatLongDate(selectedDateObject)}</div>
            <div className="text-xs font-semibold text-sky-700">{getRelativeDayLabel(selectedDate)}</div>
          </div>
          <IconButton label="Jour suivant" onClick={() => navigateDate('next')}>
            <ChevronRightIcon className="h-5 w-5" />
          </IconButton>
        </div>

        {selectedDate !== todayKey ? (
          <button
            type="button"
            onClick={goToToday}
            className="mt-3 min-h-12 w-full rounded-lg bg-white px-4 py-3 text-sm font-bold text-sky-800 shadow-sm"
          >
            Revenir à aujourd&apos;hui
          </button>
        ) : null}
      </section>

      {data && !data.hasAssignments && data.canDuplicateFromYesterday ? (
        <button
          type="button"
          onClick={handleDuplicateFromYesterday}
          disabled={duplicateMutation.isPending}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-sky-200 bg-white px-4 py-3 text-sm font-bold text-sky-800 shadow-sm disabled:opacity-60"
        >
          <CopyIcon className="h-4 w-4" />
          {duplicateMutation.isPending ? 'Duplication...' : 'Dupliquer depuis hier'}
        </button>
      ) : null}

      {planningQuery.isLoading ? <PlanningLoadingState /> : null}

      {planningQuery.isError ? (
        <PlanningErrorBlock error={planningQuery.error} onRetry={() => planningQuery.refetch()} />
      ) : null}

      {mutationError ? <ErrorBlock message={mutationError} /> : null}

      {data ? (
        <>
          <section className="grid grid-cols-2 gap-3">
            <StatTile label="Assignations" value={data.assignments.length} />
            <StatTile label="Disponibles" value={data.unassignedSupervisors.length} />
            <StatTile label="Chantiers" value={data.availableSites.length} />
            <StatTile label="Date" value={formatShortDate(selectedDateObject)} />
          </section>

          {data.assignments.length > 0 ? (
            <section className="space-y-3">
              <SectionTitle label="Assignations" count={data.assignments.length} />
              {data.assignments.map((assignment) => (
                <AssignmentCard
                  key={assignment.id}
                  assignment={assignment}
                  isEditing={editingAssignmentId === assignment.id}
                  isMutating={updateAssignmentMutation.isPending || deleteAssignmentMutation.isPending}
                  onEdit={() => setEditingAssignmentId(assignment.id)}
                  onCancelEdit={() => setEditingAssignmentId(null)}
                  onUpdate={(updateData) => updateAssignmentMutation.mutate({ id: assignment.id, data: updateData })}
                  onDelete={() => {
                    if (window.confirm('Retirer cette assignation du planning ?')) {
                      deleteAssignmentMutation.mutate(assignment.id);
                    }
                  }}
                />
              ))}
            </section>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <SectionTitle label="Superviseurs disponibles" count={data.unassignedSupervisors.length} />
              <button
                type="button"
                onClick={() => openCreateForm()}
                className="min-h-11 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white"
              >
                Ajouter
              </button>
            </div>

            {data.unassignedSupervisors.length > 0 ? (
              <div className="space-y-2">
                {data.unassignedSupervisors.map((supervisor) => (
                  <UnassignedSupervisorCard key={supervisor.id} supervisor={supervisor} onAssign={() => openCreateForm(supervisor.id)} />
                ))}
              </div>
            ) : (
              <EmptyState title="Aucun superviseur disponible" description="Tous les superviseurs du périmètre sont déjà assignés ou aucun superviseur actif n’est disponible." />
            )}
          </section>
        </>
      ) : null}

      {data?.assignments.length === 0 && data.unassignedSupervisors.length === 0 && !planningQuery.isLoading ? (
        <EmptyState title="Planning vide" description="Aucun chantier ou superviseur actif n’est disponible pour cette date." />
      ) : null}

      {showAddAssignment && data ? (
        <AssignmentBottomSheet
          title="Nouvelle assignation"
          formData={formData}
          setFormData={setFormData}
          availableSupervisors={data.unassignedSupervisors}
          availableSites={data.availableSites}
          onSubmit={handleCreateAssignment}
          onCancel={() => {
            setShowAddAssignment(false);
            setFormData(createEmptyForm(selectedDate));
          }}
          isSubmitting={createAssignmentMutation.isPending}
        />
      ) : null}
    </div>
  );
}

function AssignmentCard({
  assignment,
  isEditing,
  isMutating,
  onEdit,
  onCancelEdit,
  onUpdate,
  onDelete,
}: Readonly<{
  assignment: PlanningAssignment;
  isEditing: boolean;
  isMutating: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onUpdate: (data: UpdateAssignmentRequest) => void;
  onDelete: () => void;
}>) {
  const [editData, setEditData] = useState<UpdateAssignmentRequest>({
    action: assignment.action,
    targetProgress: assignment.targetProgress,
    status: assignment.status,
  });
  const initials = getInitials(assignment.supervisorFirstName, assignment.supervisorName);
  const clockStatus = clockInStatusConfig[assignment.clockInStatus];
  const planningStatus = planningStatusConfig[assignment.status];

  if (isEditing) {
    return (
      <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
        <AssignmentIdentity assignment={assignment} initials={initials} />
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-semibold text-slate-700">
            Action du jour
            <textarea
              value={editData.action ?? ''}
              onChange={(event) => setEditData((prev) => ({ ...prev, action: event.currentTarget.value }))}
              rows={3}
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            />
          </label>

          <label className="block text-sm font-semibold text-slate-700">
            Progression cible
            <input
              type="number"
              min="0"
              max="100"
              value={editData.targetProgress ?? ''}
              onChange={(event) =>
                setEditData((prev) => ({
                  ...prev,
                  targetProgress: event.currentTarget.value === '' ? null : Number(event.currentTarget.value),
                }))
              }
              className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
              placeholder="0-100"
            />
          </label>

          <label className="block text-sm font-semibold text-slate-700">
            Statut
            <select
              value={editData.status ?? PlanningAssignmentStatus.ASSIGNED}
              onChange={(event) => setEditData((prev) => ({ ...prev, status: event.currentTarget.value as PlanningAssignmentStatus }))}
              className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            >
              {Object.values(PlanningAssignmentStatus).map((status) => (
                <option key={status} value={status}>
                  {planningStatusConfig[status].label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onUpdate(editData)}
              disabled={isMutating || !editData.action?.trim()}
              className="min-h-12 rounded-lg bg-slate-950 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              Enregistrer
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              className="min-h-12 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700"
            >
              Annuler
            </button>
          </div>
          <button
            type="button"
            onClick={onDelete}
            disabled={isMutating}
            className="min-h-12 w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 disabled:opacity-60"
          >
            Retirer l&apos;assignation
          </button>
        </div>
      </div>
    );
  }

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-black text-sky-800">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-black text-slate-950">
            {assignment.supervisorFirstName} {assignment.supervisorName}
          </h3>
          <p className="truncate text-sm font-semibold text-slate-600">{assignment.siteName}</p>
          <p className="mt-1 text-xs text-slate-500">{assignment.siteAddress}</p>
        </div>
        <IconButton label="Modifier" onClick={onEdit}>
          <EditIcon className="h-4 w-4" />
        </IconButton>
      </div>

      <p className="mt-3 text-sm text-slate-800">{assignment.action}</p>

      {assignment.targetProgress !== null ? (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-2 flex-1 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-sky-600" style={{ width: `${assignment.targetProgress}%` }} />
          </div>
          <span className="text-xs font-bold text-sky-700">{assignment.targetProgress}%</span>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${clockStatus.className}`}>{clockStatus.label}</span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${planningStatus.className}`}>{planningStatus.label}</span>
      </div>
    </article>
  );
}

function AssignmentIdentity({ assignment, initials }: Readonly<{ assignment: PlanningAssignment; initials: string }>) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-sky-600 text-sm font-black text-white">
        {initials}
      </div>
      <div className="min-w-0">
        <h3 className="truncate text-base font-black text-slate-950">
          {assignment.supervisorFirstName} {assignment.supervisorName}
        </h3>
        <p className="truncate text-sm text-slate-600">{assignment.siteName}</p>
      </div>
    </div>
  );
}

function UnassignedSupervisorCard({ supervisor, onAssign }: Readonly<{ supervisor: UnassignedSupervisor; onAssign: () => void }>) {
  return (
    <article className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-black text-slate-700">
          {getInitials(supervisor.firstName, supervisor.name)}
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-slate-950">
            {supervisor.firstName} {supervisor.name}
          </h3>
          <p className="truncate text-xs text-slate-500">{supervisor.email}</p>
        </div>
      </div>
      <button type="button" onClick={onAssign} className="min-h-11 shrink-0 rounded-lg bg-sky-700 px-4 py-2 text-sm font-bold text-white">
        Assigner
      </button>
    </article>
  );
}

function AssignmentBottomSheet({
  title,
  formData,
  setFormData,
  availableSupervisors,
  availableSites,
  onSubmit,
  onCancel,
  isSubmitting,
}: Readonly<{
  title: string;
  formData: CreateAssignmentRequest;
  setFormData: Dispatch<SetStateAction<CreateAssignmentRequest>>;
  availableSupervisors: UnassignedSupervisor[];
  availableSites: AvailableSite[];
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}>) {
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50">
      <div className="fixed inset-x-0 bottom-0 mx-auto max-h-[86vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 shadow-[0_-12px_32px_rgba(15,23,42,0.18)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-slate-950">{title}</h2>
          <IconButton label="Fermer" onClick={onCancel}>
            <XIcon className="h-5 w-5" />
          </IconButton>
        </div>

        <div className="mt-4 space-y-4">
          <label className="block text-sm font-semibold text-slate-700">
            Superviseur
            <select
              value={formData.supervisorId}
              onChange={(event) => setFormData((prev) => ({ ...prev, supervisorId: event.currentTarget.value }))}
              className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            >
              <option value="">Sélectionner un superviseur</option>
              {availableSupervisors.map((supervisor) => (
                <option key={supervisor.id} value={supervisor.id}>
                  {supervisor.firstName} {supervisor.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-semibold text-slate-700">
            Chantier
            <select
              value={formData.siteId}
              onChange={(event) => setFormData((prev) => ({ ...prev, siteId: event.currentTarget.value }))}
              className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            >
              <option value="">Sélectionner un chantier</option>
              {availableSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name} - {site.project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-semibold text-slate-700">
            Action du jour
            <textarea
              value={formData.action}
              onChange={(event) => setFormData((prev) => ({ ...prev, action: event.currentTarget.value }))}
              rows={3}
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
              placeholder="Décrire l'action à réaliser..."
            />
          </label>

          <label className="block text-sm font-semibold text-slate-700">
            Progression cible
            <input
              type="number"
              min="0"
              max="100"
              value={formData.targetProgress ?? ''}
              onChange={(event) =>
                setFormData((prev) => ({
                  ...prev,
                  targetProgress: event.currentTarget.value === '' ? null : Number(event.currentTarget.value),
                }))
              }
              className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
              placeholder="0-100"
            />
          </label>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button type="button" onClick={onCancel} className="min-h-12 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700">
            Annuler
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!formData.supervisorId || !formData.siteId || !formData.action.trim() || isSubmitting}
            className="min-h-12 rounded-lg bg-slate-950 px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
          >
            {isSubmitting ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value }: Readonly<{ label: string; value: string | number }>) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xl font-black text-slate-950">{value}</div>
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</div>
    </div>
  );
}

function SectionTitle({ label, count }: Readonly<{ label: string; count: number }>) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-sm font-black uppercase tracking-[0.16em] text-slate-500">{label}</h2>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600">{count}</span>
    </div>
  );
}

function EmptyState({ title, description }: Readonly<{ title: string; description: string }>) {
  return (
    <section className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-center">
      <h2 className="text-base font-black text-slate-950">{title}</h2>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
    </section>
  );
}

function ErrorBlock({ message }: Readonly<{ message: string }>) {
  return <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{message}</section>;
}

function PlanningLoadingState() {
  return (
    <div className="space-y-3">
      <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
    </div>
  );
}

function IconButton({ label, onClick, children }: Readonly<{ label: string; onClick: () => void; children: ReactNode }>) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm"
    >
      {children}
    </button>
  );
}

const clockInStatusConfig: Record<PlanningClockInStatus, { label: string; className: string }> = {
  CLOCKED_IN: { label: 'Pointé', className: 'bg-emerald-100 text-emerald-700' },
  CLOCKED_OUT: { label: 'Non pointé', className: 'bg-slate-100 text-slate-700' },
  ON_PAUSE: { label: 'En pause', className: 'bg-orange-100 text-orange-700' },
};

const planningStatusConfig: Record<PlanningAssignmentStatus, { label: string; className: string }> = {
  ASSIGNED: { label: 'Assigné', className: 'bg-sky-100 text-sky-700' },
  IN_PROGRESS: { label: 'En cours', className: 'bg-indigo-100 text-indigo-700' },
  COMPLETED: { label: 'Terminé', className: 'bg-emerald-100 text-emerald-700' },
  CANCELLED: { label: 'Annulé', className: 'bg-red-100 text-red-700' },
};

function createEmptyForm(date: string): CreateAssignmentRequest {
  return {
    supervisorId: '',
    siteId: '',
    action: '',
    targetProgress: null,
    date,
  };
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

function getRelativeDayLabel(dateKey: string) {
  if (dateKey === todayKey) return "Aujourd'hui";
  if (dateKey === formatDateKey(addDays(parseDateKey(todayKey), -1))) return 'Hier';
  if (dateKey === formatDateKey(addDays(parseDateKey(todayKey), 1))) return 'Demain';
  return 'Planning';
}

function getInitials(firstName: string, lastName: string) {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

async function getApiErrorMessage(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { message?: string };
    return payload.message ?? fallback;
  } catch {
    return fallback;
  }
}

function getMutationError(error: unknown) {
  return error instanceof Error ? error.message : null;
}

function baseIcon(className: string, children: ReactNode) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

function ChevronLeftIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(className, <path d="m15 18-6-6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />);
}

function ChevronRightIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(className, <path d="m9 18 6-6-6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />);
}

function CopyIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </>,
  );
}

function EditIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />,
  );
}

function PlanningErrorBlock({ error, onRetry }: Readonly<{ error: unknown; onRetry: () => void }>) {
  const errorObj = error as any;
  let title = 'Erreur lors du chargement du planning';
  let description = 'Vérifiez votre connexion puis réessayez.';
  let showRetry = true;

  if (errorObj?.status) {
    switch (errorObj.status) {
      case 403:
        title = 'Accès refusé';
        description = 'Vous n\'avez pas les permissions nécessaires pour accéder au planning. Contactez votre administrateur.';
        showRetry = false;
        break;
      case 404:
        title = 'Planning non trouvé';
        description = 'Le planning pour cette date n\'existe pas ou a été supprimé.';
        showRetry = true;
        break;
      case 500:
        title = 'Erreur serveur';
        description = 'Une erreur technique est survenue. Veuillez réessayer dans quelques instants.';
        showRetry = true;
        break;
      default:
        title = 'Erreur lors du chargement du planning';
        description = `Une erreur est survenue (code: ${errorObj.status}). Veuillez réessayer.`;
        showRetry = true;
    }
  }

  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-4">
      <h3 className="text-sm font-bold text-red-700 mb-2">{title}</h3>
      <p className="text-xs text-red-600 mb-3">{description}</p>
      {showRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-8 rounded-lg border border-red-200 bg-red-100 px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-200"
        >
          Réessayer
        </button>
      ) : null}
    </section>
  );
}

function XIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(className, <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />);
}
