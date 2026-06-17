'use client';

import { PlanningAssignmentStatus, PlanningWorkLocationType } from '@prisma/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { SearchableSelect, type SearchableSelectOption } from '@/components/searchable-select';
import { authFetch } from '@/lib/auth/client-session';
import { getMobileOfflineCache, setMobileOfflineCache } from '@/lib/mobile-offline-db';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type {
  AvailableProject,
  AvailableNegotiationZone,
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
type HttpStatusError = Error & { status?: number };

const todayKey = formatDateKey(new Date());

export function MobilePlanningPage({ user }: MobilePlanningPageProps) {
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [showAddAssignment, setShowAddAssignment] = useState(false);
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateAssignmentRequest>(() => createEmptyForm(todayKey));
  const [usingOfflinePlanning, setUsingOfflinePlanning] = useState(false);
  const queryClient = useQueryClient();

  const planningQuery = useQuery({
    queryKey: ['mobile-planning', selectedDate],
    queryFn: async () => {
      const response = await authFetch(`/api/mobile/planning/${selectedDate}`);

      if (!response.ok) {
        const cached = await getMobileOfflineCache<PlanningDayResponse>(`planning-${selectedDate}`);
        if (cached) {
          setUsingOfflinePlanning(true);
          return cached.payload;
        }
        
        // Lancer une erreur avec le statut pour une gestion spécifique
        const error: HttpStatusError = new Error(await getApiErrorMessage(response, 'Connectez-vous pour charger le planning.'));
        error.status = response.status;
        throw error;
      }

      const payload = (await response.json()) as PlanningDayResponse;
      setUsingOfflinePlanning(false);
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
        throw new Error(await getApiErrorMessage(response, 'Impossible de créer la tâche.'));
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
        throw new Error(await getApiErrorMessage(response, 'Impossible de modifier la tâche.'));
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
        throw new Error(await getApiErrorMessage(response, 'Impossible de retirer la tâche.'));
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
  const hasAvailableSites = (data?.availableSites.length ?? 0) > 0;
  const hasAssignableResources = (data?.unassignedSupervisors.length ?? 0) > 0;
  const canOpenCreateForm = (hasAvailableSites || (data?.availableProjects.length ?? 0) > 0) && hasAssignableResources;
  const mutationError =
    getMutationError(createAssignmentMutation.error) ??
    getMutationError(updateAssignmentMutation.error) ??
    getMutationError(deleteAssignmentMutation.error) ??
    getMutationError(duplicateMutation.error);
  const assignmentGroups = useMemo(() => groupPlanningAssignments(data?.assignments ?? []), [data?.assignments]);

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
    if ((!hasAvailableSites && !(data?.availableProjects.length ?? 0)) || (!supervisorId && !hasAssignableResources)) {
      return;
    }

    setFormData({
      ...createEmptyForm(selectedDate),
      supervisorId: supervisorId ?? '',
    });
    setShowAddAssignment(true);
  }

  function handleCreateAssignment() {
    const isZoneTask = formData.workLocationType === PlanningWorkLocationType.FREE_MISSION;
    const isNegotiationZoneTask = isZoneTask && user.role === 'NEGOTIATION_MANAGER';
    if (!formData.supervisorId || !formData.action.trim() || (isNegotiationZoneTask ? !formData.projectId || !formData.zoneId : isZoneTask ? !formData.projectId : !formData.siteId)) {
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
        <h1 className="mt-1 text-xl font-black text-slate-950">Tâches du jour</h1>
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
        <PlanningErrorBlock
          error={planningQuery.error}
          onRetry={() => {
            void planningQuery.refetch();
          }}
        />
      ) : null}

      {mutationError ? <ErrorBlock message={mutationError} /> : null}

      {data ? (
        <>
          {usingOfflinePlanning ? (
            <WarningBlock message="Données hors ligne. Le dernier planning sauvegardé est affiché, mais le chargement réseau a échoué." />
          ) : null}

          <section className="grid grid-cols-2 gap-3">
            <StatTile label="Tâches" value={data.assignments.length} />
            <StatTile label="Ressources" value={data.unassignedSupervisors.length} />
            <StatTile label="Chantiers" value={data.availableSites.length} />
            <StatTile label="Date" value={formatShortDate(selectedDateObject)} />
          </section>

          {data.assignments.length > 0 ? (
            <section className="space-y-3">
              <SectionTitle label="Tâches assignées" count={data.assignments.length} />
              {assignmentGroups.map((group) => (
                <AssignmentGroupCard
                  key={group.key}
                  assignments={group.assignments}
                  editingAssignmentId={editingAssignmentId}
                  isMutating={updateAssignmentMutation.isPending || deleteAssignmentMutation.isPending}
                  onEdit={setEditingAssignmentId}
                  onCancelEdit={() => setEditingAssignmentId(null)}
                  onUpdate={(id, updateData) => updateAssignmentMutation.mutate({ id, data: updateData })}
                  onDelete={(id) => {
                    if (window.confirm('Retirer cette tâche du planning ?')) {
                      deleteAssignmentMutation.mutate(id);
                    }
                  }}
                />
              ))}
            </section>
          ) : null}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <SectionTitle label="Ressources assignables" count={data.unassignedSupervisors.length} />
              <button
                type="button"
                onClick={() => openCreateForm()}
                disabled={!canOpenCreateForm}
                className="min-h-11 rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
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
              <EmptyState title="Aucune ressource terrain active disponible" description={getResourceEmptyDescription(data.availableSites.length)} />
            )}
          </section>
        </>
      ) : null}

      {data?.availableSites.length === 0 && data?.availableProjects.length === 0 && !planningQuery.isLoading ? (
        <EmptyState
          title={user.role === 'GENERAL_SUPERVISOR' ? 'Aucun chantier confié' : 'Aucun chantier actif disponible'}
          description={
            user.role === 'GENERAL_SUPERVISOR'
              ? 'Aucun chantier ne vous a été confié pour cette période.'
              : "Aucun chantier actif n'est disponible pour créer une tâche."
          }
        />
      ) : null}

      {showAddAssignment && data ? (
        <AssignmentBottomSheet
          title="Nouvelle tâche"
          formData={formData}
          setFormData={setFormData}
          availableSupervisors={data.unassignedSupervisors}
          availableProjects={data.availableProjects}
          availableSites={data.availableSites}
          availableNegotiationZones={data.availableNegotiationZones}
          userRole={user.role}
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
    targetQuantity: assignment.targetQuantity,
    targetUnit: assignment.targetUnit,
    objectiveText: assignment.objectiveText,
    status: assignment.status,
    workLocationType: assignment.workLocationType,
  });
  const initials = getInitials(assignment.supervisorFirstName, assignment.supervisorName);
  const clockStatus = clockInStatusConfig[assignment.clockInStatus];
  const planningStatus = planningStatusConfig[assignment.status];
  const hasQuantityObjective = editData.targetQuantity !== null && editData.targetQuantity !== undefined && editData.targetQuantity > 0;

  if (isEditing) {
    return (
      <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
        <AssignmentIdentity assignment={assignment} initials={initials} />
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-semibold text-slate-700">
            Tâche à réaliser
            <textarea
              value={editData.action ?? ''}
              onChange={(event) => {
                const action = event.currentTarget.value;
                setEditData((prev) => ({ ...prev, action }));
              }}
              rows={3}
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            />
          </label>

          <div className="grid grid-cols-[1fr_96px] gap-2">
            <label className="block text-sm font-semibold text-slate-700">
              Objectif quantitatif
              <input
                type="number"
                min="0"
                step="0.01"
                value={editData.targetQuantity ?? ''}
                onChange={(event) => {
                  const targetQuantity = event.currentTarget.value;
                  const nextQuantity = targetQuantity === '' ? null : Number(targetQuantity);
                  setEditData((prev) => ({
                    ...prev,
                    targetQuantity: nextQuantity,
                    targetProgress: nextQuantity !== null && nextQuantity > 0 ? null : (prev.targetProgress ?? null),
                  }));
                }}
                className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                placeholder="12"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              Unite
              <input
                value={editData.targetUnit ?? ''}
                onChange={(event) => {
                  const targetUnit = event.currentTarget.value;
                  setEditData((prev) => ({ ...prev, targetUnit }));
                }}
                className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                placeholder="u"
              />
            </label>
          </div>

          {hasQuantityObjective ? (
            <div className="rounded-lg border border-sky-100 bg-sky-50 p-3 text-xs font-semibold text-sky-800">
              La progression sera calculee depuis la quantite realisee.
            </div>
          ) : (
            <label className="block text-sm font-semibold text-slate-700">
              Progression cible (si pas de quantite)
              <input
                type="number"
                min="0"
                max="100"
                value={editData.targetProgress ?? ''}
                onChange={(event) => {
                  const targetProgress = event.currentTarget.value;
                  setEditData((prev) => ({
                    ...prev,
                    targetProgress: targetProgress === '' ? null : Number(targetProgress),
                  }));
                }}
                className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                placeholder="0-100"
              />
              <span className="mt-2 block text-xs font-semibold text-slate-500">
                Uniquement pour les taches sans objectif quantitatif.
              </span>
            </label>
          )}

          <label className="block text-sm font-semibold text-slate-700">
            Consigne / objectif texte (facultatif)
            <textarea
              value={editData.objectiveText ?? ''}
              onChange={(event) => {
                const objectiveText = event.currentTarget.value;
                setEditData((prev) => ({ ...prev, objectiveText }));
              }}
              rows={2}
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
              placeholder="Ex : finaliser les reprises, preparer le PV..."
            />
            <span className="mt-2 block text-xs font-semibold text-slate-500">
              Precision libre, sans calcul de progression.
            </span>
          </label>

          <label className="block text-sm font-semibold text-slate-700">
            Statut
            <select
              value={editData.status ?? PlanningAssignmentStatus.ASSIGNED}
              onChange={(event) => {
                const status = event.currentTarget.value as PlanningAssignmentStatus;
                setEditData((prev) => ({ ...prev, status }));
              }}
              className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            >
              {Object.values(PlanningAssignmentStatus).map((status) => (
                <option key={status} value={status}>
                  {planningStatusConfig[status].label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Type de tâche
            <select
              value={editData.workLocationType ?? PlanningWorkLocationType.ON_SITE}
              onChange={(event) => {
                const workLocationType = event.currentTarget.value as PlanningWorkLocationType;
                setEditData((prev) => ({ ...prev, workLocationType }));
              }}
              className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            >
              {creatableWorkLocationTypes.map((type) => (
                <option key={type} value={type}>
                  {workLocationTypeLabel[type]}
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
            Retirer la tâche
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
      {assignment.objectiveText ? <p className="mt-2 text-xs font-semibold text-slate-600">{assignment.objectiveText}</p> : null}
      {assignment.targetQuantity !== null && assignment.targetQuantity > 0 ? (
        <p className="mt-2 text-xs font-bold text-sky-700">
          Objectif {formatQuantity(assignment.targetQuantity)} {assignment.targetUnit ?? ''}
        </p>
      ) : null}

      {(assignment.targetQuantity === null || assignment.targetQuantity <= 0) && assignment.targetProgress !== null ? (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-2 flex-1 rounded-full bg-slate-100">
            <div className="h-2 rounded-full bg-sky-600" style={{ width: `${assignment.targetProgress}%` }} />
          </div>
          <span className="text-xs font-bold text-sky-700">{assignment.targetProgress}%</span>
        </div>
      ) : null}
      <ObjectiveStatusPill assignment={assignment} />

      <div className="mt-3 flex flex-wrap gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${clockStatus.className}`}>{clockStatus.label}</span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${planningStatus.className}`}>{planningStatus.label}</span>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
          {workLocationTypeLabel[assignment.workLocationType]}
        </span>
      </div>
    </article>
  );
}

type AssignmentGroup = {
  key: string;
  assignments: PlanningAssignment[];
};

function AssignmentGroupCard({
  assignments,
  editingAssignmentId,
  isMutating,
  onEdit,
  onCancelEdit,
  onUpdate,
  onDelete,
}: Readonly<{
  assignments: PlanningAssignment[];
  editingAssignmentId: string | null;
  isMutating: boolean;
  onEdit: (id: string) => void;
  onCancelEdit: () => void;
  onUpdate: (id: string, data: UpdateAssignmentRequest) => void;
  onDelete: (id: string) => void;
}>) {
  const firstAssignment = assignments[0];

  if (!firstAssignment) {
    return null;
  }

  const initials = getInitials(firstAssignment.supervisorFirstName, firstAssignment.supervisorName);
  const clockStatus = clockInStatusConfig[firstAssignment.clockInStatus];

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-black text-sky-800">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-black text-slate-950">
            {firstAssignment.supervisorFirstName} {firstAssignment.supervisorName}
          </h3>
          <p className="truncate text-sm font-semibold text-slate-600">{firstAssignment.siteName}</p>
          <p className="mt-1 text-xs text-slate-500">{firstAssignment.siteAddress}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${clockStatus.className}`}>
          {clockStatus.label}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {assignments.map((assignment, index) =>
          editingAssignmentId === assignment.id ? (
            <AssignmentCard
              key={assignment.id}
              assignment={assignment}
              isEditing
              isMutating={isMutating}
              onEdit={() => onEdit(assignment.id)}
              onCancelEdit={onCancelEdit}
              onUpdate={(updateData) => onUpdate(assignment.id, updateData)}
              onDelete={() => onDelete(assignment.id)}
            />
          ) : (
            <AssignmentTaskRow
              key={assignment.id}
              assignment={assignment}
              index={index}
              onEdit={() => onEdit(assignment.id)}
            />
          ),
        )}
      </div>
    </article>
  );
}

function AssignmentTaskRow({
  assignment,
  index,
  onEdit,
}: Readonly<{
  assignment: PlanningAssignment;
  index: number;
  onEdit: () => void;
}>) {
  const planningStatus = planningStatusConfig[assignment.status];

  return (
    <section className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Tâche {index + 1}</p>
          <p className="mt-1 text-sm leading-6 text-slate-800">{assignment.action}</p>
          {assignment.objectiveText ? <p className="mt-1 text-xs font-semibold text-slate-500">{assignment.objectiveText}</p> : null}
          {assignment.targetQuantity !== null && assignment.targetQuantity > 0 ? (
            <p className="mt-1 text-xs font-bold text-sky-700">
              Objectif {formatQuantity(assignment.targetQuantity)} {assignment.targetUnit ?? ''}
            </p>
          ) : null}
        </div>
        <IconButton label="Modifier" onClick={onEdit}>
          <EditIcon className="h-4 w-4" />
        </IconButton>
      </div>

      {(assignment.targetQuantity === null || assignment.targetQuantity <= 0) && assignment.targetProgress !== null ? (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-2 flex-1 rounded-full bg-white">
            <div className="h-2 rounded-full bg-sky-600" style={{ width: `${assignment.targetProgress}%` }} />
          </div>
          <span className="text-xs font-bold text-sky-700">{assignment.targetProgress}%</span>
        </div>
      ) : null}
      <ObjectiveStatusPill assignment={assignment} />

      <div className="mt-3">
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${planningStatus.className}`}>
          {planningStatus.label}
        </span>
        <span className="ml-2 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700">
          {workLocationTypeLabel[assignment.workLocationType]}
        </span>
      </div>
    </section>
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

function ObjectiveStatusPill({ assignment }: Readonly<{ assignment: PlanningAssignment }>) {
  const config = objectiveStatusConfig[assignment.objectiveStatus];

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${config.className}`}>{config.label}</span>
      {assignment.targetQuantity !== null && assignment.actualQuantity !== null ? (
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700">
          {formatQuantity(assignment.actualQuantity)} / {formatQuantity(assignment.targetQuantity)} {assignment.targetUnit ?? ''}
          {assignment.remainingQuantity !== null && assignment.remainingQuantity > 0
            ? ` - reste ${formatQuantity(assignment.remainingQuantity)}`
            : ''}
        </span>
      ) : null}
      {assignment.actualProgress !== null ? (
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-700">
          Réel {assignment.actualProgress}%
          {assignment.progressDelta !== null ? ` (${assignment.progressDelta >= 0 ? '+' : ''}${assignment.progressDelta}%)` : ''}
        </span>
      ) : null}
      {assignment.latestProgressUpdate?.comment ? (
        <span className="line-clamp-1 text-xs font-semibold text-slate-500">{assignment.latestProgressUpdate.comment}</span>
      ) : null}
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
          <p className="truncate text-xs font-semibold text-sky-700">{supervisor.availabilityLabel}</p>
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
  availableProjects,
  availableSites,
  availableNegotiationZones,
  userRole,
  onSubmit,
  onCancel,
  isSubmitting,
}: Readonly<{
  title: string;
  formData: CreateAssignmentRequest;
  setFormData: Dispatch<SetStateAction<CreateAssignmentRequest>>;
  availableSupervisors: UnassignedSupervisor[];
  availableProjects: AvailableProject[];
  availableSites: AvailableSite[];
  availableNegotiationZones: AvailableNegotiationZone[];
  userRole: string;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
}>) {
  const [siteSearch, setSiteSearch] = useState('');
  const [resourceSearch, setResourceSearch] = useState('');
  const isZoneTask = formData.workLocationType === PlanningWorkLocationType.FREE_MISSION;
  const isNegotiationZoneTask = isZoneTask && userRole === 'NEGOTIATION_MANAGER';
  const requiresSite = !isZoneTask;
  const hasAvailableSites = availableSites.length > 0;
  const hasAvailableProjects = availableProjects.length > 0;
  const hasAvailableSupervisors = availableSupervisors.length > 0;
  const canSubmit = Boolean(
    formData.supervisorId &&
      formData.action.trim() &&
      hasAvailableSupervisors &&
      (isNegotiationZoneTask
        ? formData.projectId && formData.zoneId && hasAvailableProjects
        : isZoneTask
          ? formData.projectId && hasAvailableProjects
          : formData.siteId && hasAvailableSites),
  );
  const hasQuantityObjective = formData.targetQuantity !== null && formData.targetQuantity !== undefined && formData.targetQuantity > 0;
  const supervisorOptions = toMobileSupervisorOptions(availableSupervisors);
  const projectOptions = toMobileProjectOptions(availableProjects);
  const normalizedResourceSearch = resourceSearch.trim().toLowerCase();
  const normalizedSiteSearch = siteSearch.trim().toLowerCase();
  const sitesForProject = formData.projectId ? availableSites.filter((site) => site.project.id === formData.projectId) : availableSites;
  const siteOptions = toMobileSiteOptions(sitesForProject);
  const zonesForProject = formData.projectId
    ? availableNegotiationZones.filter((zone) => zone.projectId === formData.projectId)
    : availableNegotiationZones;
  const zoneOptions = toMobileNegotiationZoneOptions(zonesForProject);
  const filteredSupervisors = normalizedResourceSearch
    ? availableSupervisors.filter((supervisor) =>
        `${supervisor.firstName} ${supervisor.name} ${supervisor.email} ${supervisor.availabilityLabel}`
          .toLowerCase()
          .includes(normalizedResourceSearch),
      )
    : availableSupervisors;
  const selectedSupervisor = availableSupervisors.find((supervisor) => supervisor.id === formData.supervisorId);
  const displayedSupervisors =
    selectedSupervisor && !filteredSupervisors.some((supervisor) => supervisor.id === selectedSupervisor.id)
      ? [selectedSupervisor, ...filteredSupervisors]
      : filteredSupervisors;
  const filteredSites = normalizedSiteSearch
    ? sitesForProject.filter((site) =>
        `${site.project.name} ${site.name} ${site.address}`.toLowerCase().includes(normalizedSiteSearch),
      )
    : sitesForProject;
  const selectedSite = availableSites.find((site) => site.id === formData.siteId);
  const displayedSites =
    selectedSite && !filteredSites.some((site) => site.id === selectedSite.id)
      ? [selectedSite, ...filteredSites]
      : filteredSites;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50">
      <div className="fixed inset-x-0 bottom-0 mx-auto max-h-[86vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 shadow-[0_-12px_32px_rgba(15,23,42,0.18)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-slate-950">{title}</h2>
          <IconButton label="Fermer" onClick={onCancel}>
            <XIcon className="h-5 w-5" />
          </IconButton>
        </div>

        {requiresSite && !hasAvailableSites ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
            Aucun chantier actif disponible.
          </div>
        ) : null}

        {isZoneTask && !hasAvailableProjects ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
            Aucun projet actif disponible pour creer une zone.
          </div>
        ) : null}

        {(hasAvailableSites || hasAvailableProjects) && !hasAvailableSupervisors ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
            Aucune ressource terrain active disponible.
          </div>
        ) : null}

        <div className="mt-4 space-y-4">
          <label className="block text-sm font-semibold text-slate-700">
            Type de tache
            <select
              value={formData.workLocationType ?? PlanningWorkLocationType.ON_SITE}
              onChange={(event) => {
                const workLocationType = event.currentTarget.value as PlanningWorkLocationType;
                setFormData((prev) => ({
                  ...prev,
                  workLocationType,
                  siteId: workLocationType === PlanningWorkLocationType.FREE_MISSION ? '' : (prev.siteId ?? ''),
                  zoneId: workLocationType === PlanningWorkLocationType.FREE_MISSION ? (prev.zoneId ?? '') : '',
                }));
              }}
              className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            >
              {creatableWorkLocationTypes.map((type) => (
                <option key={type} value={type}>
                  {workLocationTypeLabel[type]}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs font-semibold text-slate-500">
              Chantier demande un chantier. Zone se rattache seulement a un projet.
            </p>
          </label>

          <label className="block text-sm font-semibold text-slate-700">
            Ressource terrain
            <SearchableSelect
              className="mt-2"
              emptyLabel="Aucune ressource ne correspond à la recherche."
              onChange={(supervisorId) => setFormData((prev) => ({ ...prev, supervisorId }))}
              options={supervisorOptions}
              placeholder="Sélectionner une ressource"
              value={formData.supervisorId ?? ''}
            />
          </label>

          <label className="block text-sm font-semibold text-slate-700">
            Projet
            <SearchableSelect
              className="mt-2"
              emptyLabel="Aucun projet ne correspond a la recherche."
              onChange={(projectId) =>
                setFormData((prev) => ({
                  ...prev,
                  projectId,
                  zoneId:
                    prev.zoneId && availableNegotiationZones.some((zone) => zone.id === prev.zoneId && zone.projectId === projectId)
                      ? prev.zoneId
                      : '',
                  siteId:
                    prev.siteId && availableSites.some((site) => site.id === prev.siteId && site.project.id === projectId)
                      ? prev.siteId
                      : '',
                }))
              }
              options={projectOptions}
              placeholder="Selectionner un projet"
              value={formData.projectId ?? ''}
            />
          </label>

          {isNegotiationZoneTask ? (
            <label className="block text-sm font-semibold text-slate-700">
              Zone
              <SearchableSelect
                className="mt-2"
                emptyLabel={formData.projectId ? 'Aucune zone ne correspond a ce projet.' : 'Selectionne un projet avant la zone.'}
                onChange={(zoneId) => {
                  const zone = availableNegotiationZones.find((item) => item.id === zoneId);
                  setFormData((prev) => ({
                    ...prev,
                    zoneId,
                    projectId: zone?.projectId ?? prev.projectId ?? '',
                    action: prev.action.trim() ? prev.action : zone ? `Negociation - ${zone.name}` : prev.action,
                  }));
                }}
                options={zoneOptions}
                placeholder="Selectionner une zone"
                value={formData.zoneId ?? ''}
              />
            </label>
          ) : null}

          <label className={requiresSite ? 'block text-sm font-semibold text-slate-700' : 'hidden'}>
            Chantier
            <SearchableSelect
              className="mt-2"
              emptyLabel="Aucun chantier ne correspond à la recherche."
              onChange={(siteId) => {
                const site = availableSites.find((item) => item.id === siteId);
                setFormData((prev) => ({ ...prev, siteId, projectId: site?.project.id ?? prev.projectId ?? '' }));
              }}
              options={siteOptions}
              placeholder="Sélectionner un chantier"
              value={formData.siteId ?? ''}
            />
          </label>

          <label className="hidden text-sm font-semibold text-slate-700">
            Ressource terrain
            {availableSupervisors.length > 4 ? (
              <input
                type="search"
                value={resourceSearch}
                onChange={(event) => {
                  setResourceSearch(event.currentTarget.value);
                }}
                className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                placeholder="Rechercher une ressource..."
              />
            ) : null}
            <select
              value={formData.supervisorId}
              onChange={(event) => {
                const supervisorId = event.currentTarget.value;
                setFormData((prev) => ({ ...prev, supervisorId }));
              }}
              className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            >
              <option value="">Sélectionner une ressource</option>
              {displayedSupervisors.length === 0 ? (
                <option value="" disabled>
                  Aucune ressource ne correspond à la recherche
                </option>
              ) : null}
              {displayedSupervisors.map((supervisor) => (
                <option key={supervisor.id} value={supervisor.id}>
                  {supervisor.firstName} {supervisor.name} ({supervisor.availabilityLabel})
                </option>
              ))}
            </select>
          </label>

          <label className="hidden text-sm font-semibold text-slate-700">
            Chantier
            {availableSites.length > 1 ? (
              <input
                type="search"
                value={siteSearch}
                onChange={(event) => {
                  setSiteSearch(event.currentTarget.value);
                }}
                className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                placeholder="Rechercher un chantier..."
              />
            ) : null}
            <select
              value={formData.siteId ?? ''}
              onChange={(event) => {
                const siteId = event.currentTarget.value;
                setFormData((prev) => ({ ...prev, siteId }));
              }}
              className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            >
              <option value="">Sélectionner un chantier</option>
              {displayedSites.length === 0 ? (
                <option value="" disabled>
                  Aucun chantier ne correspond à la recherche
                </option>
              ) : null}
              {displayedSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.project.name} â€” {site.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-semibold text-slate-700">
            Tâche à réaliser
            <textarea
              value={formData.action}
              onChange={(event) => {
                const action = event.currentTarget.value;
                setFormData((prev) => ({ ...prev, action }));
              }}
              rows={3}
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
              placeholder="Décrire la tâche à réaliser..."
            />
          </label>

          <div className="grid grid-cols-[1fr_96px] gap-2">
            <label className="block text-sm font-semibold text-slate-700">
              Objectif quantitatif
              <input
                type="number"
                min="0"
                step="0.01"
                value={formData.targetQuantity ?? ''}
                onChange={(event) => {
                  const targetQuantity = event.currentTarget.value;
                  const nextQuantity = targetQuantity === '' ? null : Number(targetQuantity);
                  setFormData((prev) => ({
                    ...prev,
                    targetQuantity: nextQuantity,
                    targetProgress: nextQuantity !== null && nextQuantity > 0 ? null : (prev.targetProgress ?? null),
                  }));
                }}
                className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                placeholder="12"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700">
              Unite
              <input
                value={formData.targetUnit ?? ''}
                onChange={(event) => {
                  const targetUnit = event.currentTarget.value;
                  setFormData((prev) => ({ ...prev, targetUnit }));
                }}
                className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                placeholder="u"
              />
            </label>
          </div>

          {hasQuantityObjective ? (
            <div className="rounded-lg border border-sky-100 bg-sky-50 p-3 text-xs font-semibold text-sky-800">
              La progression sera calculee depuis la quantite realisee.
            </div>
          ) : (
            <label className="block text-sm font-semibold text-slate-700">
              Progression cible (si pas de quantite)
              <input
                type="number"
                min="0"
                max="100"
                value={formData.targetProgress ?? ''}
                onChange={(event) => {
                  const targetProgress = event.currentTarget.value;
                  setFormData((prev) => ({
                    ...prev,
                    targetProgress: targetProgress === '' ? null : Number(targetProgress),
                  }));
                }}
                className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
                placeholder="0-100"
              />
              <span className="mt-2 block text-xs font-semibold text-slate-500">
                Uniquement pour les taches sans objectif quantitatif.
              </span>
            </label>
          )}

          <label className="hidden">
            Type de tâche
            <select
              value={formData.workLocationType ?? PlanningWorkLocationType.ON_SITE}
              onChange={(event) => {
                const workLocationType = event.currentTarget.value as PlanningWorkLocationType;
                setFormData((prev) => ({ ...prev, workLocationType }));
              }}
              className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
            >
              {creatableWorkLocationTypes.map((type) => (
                <option key={type} value={type}>
                  {workLocationTypeLabel[type]}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs font-semibold text-slate-500">
              Le bureau est maintenant couvert par le pointage quotidien, pas par une tâche planning.
            </p>
          </label>

          <label className="block text-sm font-semibold text-slate-700">
            Consigne / objectif texte (facultatif)
            <textarea
              value={formData.objectiveText ?? ''}
              onChange={(event) => {
                const objectiveText = event.currentTarget.value;
                setFormData((prev) => ({ ...prev, objectiveText }));
              }}
              rows={2}
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20"
              placeholder="Ex : finaliser les reprises, preparer le PV..."
            />
            <span className="mt-2 block text-xs font-semibold text-slate-500">
              Precision libre, sans calcul de progression.
            </span>
          </label>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button type="button" onClick={onCancel} className="min-h-12 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700">
            Annuler
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit || isSubmitting}
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

function WarningBlock({ message }: Readonly<{ message: string }>) {
  return <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">{message}</section>;
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

const workLocationTypeLabel: Record<PlanningWorkLocationType, string> = {
  ON_SITE: 'Chantier',
  OFFICE: 'Bureau',
  FREE_MISSION: 'Zone',
};
const creatableWorkLocationTypes: PlanningWorkLocationType[] = [
  PlanningWorkLocationType.ON_SITE,
  PlanningWorkLocationType.OFFICE,
  PlanningWorkLocationType.FREE_MISSION,
];

workLocationTypeLabel.ON_SITE = 'Chantier';
workLocationTypeLabel.OFFICE = 'Bureau';
workLocationTypeLabel.FREE_MISSION = 'Zone';

const objectiveStatusConfig: Record<PlanningAssignment['objectiveStatus'], { label: string; className: string }> = {
  NOT_STARTED: { label: 'Non démarré', className: 'bg-slate-100 text-slate-700' },
  PARTIAL: { label: 'Partiel', className: 'bg-orange-100 text-orange-700' },
  ACHIEVED: { label: 'Atteint', className: 'bg-emerald-100 text-emerald-700' },
  BLOCKED: { label: 'Bloqué', className: 'bg-red-100 text-red-700' },
};

function createEmptyForm(date: string): CreateAssignmentRequest {
  return {
    supervisorId: '',
    siteId: '',
    projectId: '',
    zoneId: '',
    action: '',
    targetProgress: null,
    targetQuantity: null,
    targetUnit: null,
    objectiveText: null,
    date,
    workLocationType: PlanningWorkLocationType.ON_SITE,
  };
}

function toMobileSupervisorOptions(supervisors: UnassignedSupervisor[]): SearchableSelectOption[] {
  return supervisors.map((supervisor) => ({
    value: supervisor.id,
    label: `${supervisor.firstName} ${supervisor.name}`,
    description: supervisor.availabilityLabel,
    keywords: `${supervisor.email ?? ''} ${supervisor.availabilityLabel}`,
  }));
}

function toMobileSiteOptions(sites: AvailableSite[]): SearchableSelectOption[] {
  return sites.map((site) => ({
    value: site.id,
    label: site.name,
    description: site.project.name,
    keywords: `${site.address} ${site.project.name}`,
  }));
}

function toMobileProjectOptions(projects: AvailableProject[]): SearchableSelectOption[] {
  return projects.map((project) => ({
    value: project.id,
    label: project.name,
  }));
}

function toMobileNegotiationZoneOptions(zones: AvailableNegotiationZone[]): SearchableSelectOption[] {
  return zones.map((zone) => ({
    value: zone.id,
    label: zone.name,
    description: [zone.project.name, zone.city, `${zone.scopeCount} scope(s)`].filter(Boolean).join(' - '),
    keywords: `${zone.project.name} ${zone.city ?? ''} ${zone.region ?? ''}`,
  }));
}

function formatQuantity(value: number | null) {
  if (value === null) return null;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
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

function groupPlanningAssignments(assignments: PlanningAssignment[]): AssignmentGroup[] {
  const groups = new Map<string, PlanningAssignment[]>();

  for (const assignment of assignments) {
    const key = `${assignment.supervisorId}:${assignment.siteId}`;
    const group = groups.get(key);

    if (group) {
      group.push(assignment);
    } else {
      groups.set(key, [assignment]);
    }
  }

  return [...groups.entries()].map(([key, groupedAssignments]) => ({
    key,
    assignments: groupedAssignments,
  }));
}

function getResourceEmptyDescription(siteCount: number) {
  if (siteCount === 0) {
    return "Aucun chantier actif n'est disponible pour créer une tâche.";
  }

  return "Aucune ressource terrain active n'est disponible pour créer une tâche.";
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
  const errorObj = error as HttpStatusError;
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
