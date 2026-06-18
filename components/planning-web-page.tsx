'use client';

import Link from 'next/link';
import { PlanningAssignmentStatus, PlanningWorkLocationType, type Role } from '@prisma/client';
import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Copy, Download, Pencil, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { SearchableMultiSelect, SearchableSelect, type SearchableSelectOption } from '@/components/searchable-select';
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
  PlanningWebDuplicateResponse,
  PlanningWebFilters,
  PlanningWebMutationResponse,
  PlanningWebUpdateRequest,
} from '@/types/planning-web';
import type { AvailableNegotiationZone, AvailableSite, UnassignedSupervisor } from '@/types/mobile-planning';
import type { PlanningTaskTemplateItem, PlanningTaskTemplatesResponse } from '@/types/planning-templates';
import type {
  PlanningImportCommitResponse,
  PlanningImportPreviewResponse,
  PlanningImportPreviewRow,
} from '@/types/planning-import';

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
  initialWorkLocationType?: PlanningWorkLocationType;
  supervisorId: string;
  supervisorIds: string[];
  projectId: string;
  zoneId: string;
  siteId: string;
  date: string;
  action: string;
  targetProgress: string;
  targetQuantity: string;
  targetUnit: string;
  objectiveText: string;
  plannedDurationMinutes: string;
  status: PlanningAssignmentStatus;
  workLocationType: PlanningWorkLocationType;
};

type FreeMissionWebRequest = {
  projectId: string;
  assigneeId: string;
  assigneeIds?: string[];
  date: string;
  action: string;
  targetProgress: number | null;
  targetQuantity: number | null;
  targetUnit: string | null;
  objectiveText: string | null;
  plannedDurationMinutes: number | null;
};

type CreateSummaryResponse = {
  createdCount?: number;
  skippedCount?: number;
};

type NegotiationZonePlanningRequest = {
  date: string;
  projectId: string;
  assigneeIds: string[];
  zoneId: string | null;
  plannedZone: string | null;
  instruction: string | null;
};

type ConvertToZoneRequest =
  | { sourceAssignmentId: string; date: string; type: 'FREE_MISSION'; data: FreeMissionWebRequest }
  | { sourceAssignmentId: string; date: string; type: 'NEGOTIATION_ZONE'; data: NegotiationZonePlanningRequest };

const todayKey = formatDateKey(new Date());
const filterClassName =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-500';
const buttonClassName =
  'rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

const planningStatusLabel: Record<PlanningAssignmentStatus, string> = {
  ASSIGNED: 'Non démarré',
  IN_PROGRESS: 'En cours',
  COMPLETED: 'Terminé',
  CANCELLED: 'Annulé',
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

const objectiveStatusConfig = {
  NOT_STARTED: { label: 'Non démarré', tone: 'neutral' },
  PARTIAL: { label: 'Partiel', tone: 'warning' },
  ACHIEVED: { label: 'Atteint', tone: 'success' },
  BLOCKED: { label: 'Bloqué', tone: 'error' },
} as const;

export function PlanningWebPage({ viewer }: PlanningWebPageProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const isCentralizedOnlyPlanning = viewer.role === 'DIRECTION' || viewer.role === 'ADMIN';
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [duplicateTargetDate, setDuplicateTargetDate] = useState(() => formatDateKey(addDays(parseDateKey(todayKey), 1)));
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
    projectManagerId: '',
  });
  const [drawerMode, setDrawerMode] = useState<DrawerMode | null>(null);
  const [form, setForm] = useState<AssignmentFormState>(() => createEmptyForm(selectedDate));
  const [deleteTarget, setDeleteTarget] = useState<PlanningWebAssignment | null>(null);
  const [planningImportOpen, setPlanningImportOpen] = useState(false);
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
  const templatesQuery = useQuery({
    queryKey: ['planning-task-templates'],
    queryFn: fetchPlanningTemplates,
    enabled: canMutate,
    staleTime: 60_000,
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
        projectManagerId: '',
      }),
    enabled: canMutate && canViewCentralized && Boolean(drawerMode && form.date && form.supervisorId),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (isCentralizedOnlyPlanning && viewMode !== 'centralized') {
      setViewMode('centralized');
    }
  }, [isCentralizedOnlyPlanning, viewMode]);

  useEffect(() => {
    setDuplicateTargetDate(formatDateKey(addDays(parseDateKey(selectedDate), 1)));
  }, [selectedDate]);

  const createMutation = useMutation({
    mutationFn: createAssignment,
    onSuccess: async (result, payload) => {
      pushToast({ type: 'success', title: formatCreateSuccessTitle(result, 'Tâche créée') });
      if (payload.date !== selectedDate) {
        setSelectedDate(payload.date);
      }
      setFilters((current) => ({
        ...current,
        projectId: '',
        siteId: '',
        resourceId: '',
      }));
      closeDrawer();
      await queryClient.invalidateQueries({ queryKey: ['web-planning'] });
      await queryClient.refetchQueries({ queryKey: ['web-planning'], type: 'active' });
    },
    onError: (error) => pushMutationError(error, "Creation impossible"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: PlanningWebUpdateRequest }) => updateAssignment(id, data),
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Tâche modifiée' });
      closeDrawer();
      await queryClient.invalidateQueries({ queryKey: ['web-planning'] });
      await queryClient.refetchQueries({ queryKey: ['web-planning'], type: 'active' });
    },
    onError: (error) => pushMutationError(error, 'Modification impossible'),
  });

  const freeMissionMutation = useMutation({
    mutationFn: ({ id, data }: { id?: string; data: FreeMissionWebRequest }) =>
      id ? updateFreeMission(id, data) : createFreeMission(data),
    onSuccess: async (result, variables) => {
      pushToast({ type: 'success', title: formatCreateSuccessTitle(result, 'Zone enregistree') });
      if (variables.data.date !== selectedDate) {
        setSelectedDate(variables.data.date);
      }
      setFilters((current) => ({
        ...current,
        projectId: variables.data.projectId,
        siteId: '',
        resourceId: variables.data.assigneeId,
      }));
      closeDrawer();
      await queryClient.invalidateQueries({ queryKey: ['web-planning'] });
    },
    onError: (error) => pushMutationError(error, 'Zone impossible'),
  });

  const negotiationZoneMutation = useMutation({
    mutationFn: createNegotiationZoneAssignments,
    onSuccess: async (result, payload) => {
      pushToast({ type: 'success', title: formatCreateSuccessTitle(result, 'Zone nego enregistree') });
      if (payload.date !== selectedDate) {
        setSelectedDate(payload.date);
      }
      setFilters((current) => ({
        ...current,
        projectId: payload.projectId,
        siteId: '',
        resourceId: payload.assigneeIds[0] ?? current.resourceId,
      }));
      closeDrawer();
      await queryClient.invalidateQueries({ queryKey: ['web-planning'] });
      await queryClient.refetchQueries({ queryKey: ['web-planning'], type: 'active' });
      await queryClient.invalidateQueries({ queryKey: ['negotiation-overview'] });
    },
    onError: (error) => pushMutationError(error, 'Zone nego impossible'),
  });

  const convertToZoneMutation = useMutation({
    mutationFn: convertAssignmentToZone,
    onSuccess: async (result, payload) => {
      pushToast({ type: 'success', title: formatCreateSuccessTitle(result, 'Zone enregistree') });
      if (payload.date !== selectedDate) {
        setSelectedDate(payload.date);
      }
      setFilters((current) => ({
        ...current,
        projectId: payload.data.projectId,
        siteId: '',
        resourceId:
          payload.type === 'NEGOTIATION_ZONE'
            ? (payload.data.assigneeIds[0] ?? current.resourceId)
            : payload.data.assigneeId,
      }));
      closeDrawer();
      await queryClient.invalidateQueries({ queryKey: ['web-planning'] });
      await queryClient.refetchQueries({ queryKey: ['web-planning'], type: 'active' });
      if (payload.type === 'NEGOTIATION_ZONE') {
        await queryClient.invalidateQueries({ queryKey: ['negotiation-overview'] });
      }
    },
    onError: (error) => pushMutationError(error, 'Conversion zone impossible'),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAssignment,
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Tâche supprimée' });
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['web-planning'] });
      await queryClient.refetchQueries({ queryKey: ['web-planning'], type: 'active' });
    },
    onError: (error) => pushMutationError(error, 'Suppression impossible'),
  });

  const planningImportPreviewMutation = useMutation({
    mutationFn: previewPlanningImportFile,
    onError: (error) => pushMutationError(error, 'Prévisualisation impossible'),
  });

  const planningImportCommitMutation = useMutation({
    mutationFn: commitPlanningImportRows,
    onSuccess: async (result) => {
      pushToast({
        type: 'success',
        title: "Import planning terminé",
        message: `${result.createdAssignmentsCount + result.createdFreeMissionsCount} tâche(s), ${result.createdTemplatesCount} modèle(s).`,
      });
      await queryClient.invalidateQueries({ queryKey: ['web-planning'] });
      await queryClient.invalidateQueries({ queryKey: ['planning-task-templates'] });
    },
    onError: (error) => pushMutationError(error, "Import planning impossible"),
  });

  const duplicateMutation = useMutation({
    mutationFn: duplicatePlanning,
    onSuccess: async (result) => {
      pushToast({
        type: 'success',
        title: `${result.createdCount} tache(s) dupliquee(s)`,
        ...(result.skippedCount > 0 ? { message: `${result.skippedCount} deja existante(s) ou hors perimetre ignoree(s).` } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ['web-planning'] });
    },
    onError: (error) => pushMutationError(error, 'Duplication impossible'),
  });
  const saveTemplateMutation = useMutation({
    mutationFn: savePlanningTemplate,
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Modèle enregistré' });
      await queryClient.invalidateQueries({ queryKey: ['planning-task-templates'] });
    },
    onError: (error) => pushMutationError(error, 'Modèle impossible'),
  });

  const data = dayQuery.data;
  const filteredAssignments = useMemo(
    () => filterAssignments(data?.assignments ?? [], data?.availableSites ?? [], filters),
    [data, filters],
  );
  const projects = useMemo(
    () => data?.availableProjects ?? getProjectOptions(data?.availableSites ?? []),
    [data],
  );
  const sites = useMemo(() => data?.availableSites ?? [], [data?.availableSites]);
  const negotiationZones = useMemo(() => data?.availableNegotiationZones ?? [], [data?.availableNegotiationZones]);
  const resources = useMemo(() => data?.unassignedSupervisors ?? [], [data?.unassignedSupervisors]);
  const centralizedItems = useMemo(() => centralizedQuery.data?.items ?? [], [centralizedQuery.data?.items]);
  const centralizedOptions = useMemo(() => getCentralizedOptions(centralizedItems), [centralizedItems]);
  const dayProjectSelectOptions = useMemo(() => toProjectSelectOptions(projects), [projects]);
  const daySiteSelectOptions = useMemo(
    () => toSiteSelectOptions(sites.filter((site) => !filters.projectId || site.project.id === filters.projectId)),
    [filters.projectId, sites],
  );
  const dayResourceSelectOptions = useMemo(() => toResourceSelectOptions(resources), [resources]);
  const centralizedProjectSelectOptions = useMemo(
    () => toProjectSelectOptions(centralizedOptions.projects),
    [centralizedOptions.projects],
  );
  const centralizedSiteSelectOptions = useMemo(
    () =>
      centralizedOptions.sites
        .filter((site) => !centralizedFilters.projectId || site.projectId === centralizedFilters.projectId)
        .map((site) => ({ value: site.id, label: site.name })),
    [centralizedFilters.projectId, centralizedOptions.sites],
  );
  const centralizedResourceSelectOptions = useMemo(
    () => centralizedOptions.resources.map((resource) => ({ value: resource.id, label: resource.name })),
    [centralizedOptions.resources],
  );
  const centralizedProjectManagerSelectOptions = useMemo(
    () => centralizedOptions.projectManagers.map((manager) => ({ value: manager.id, label: manager.name })),
    [centralizedOptions.projectManagers],
  );
  const selectedDateObject = parseDateKey(selectedDate);
  const isMutating =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    freeMissionMutation.isPending ||
    negotiationZoneMutation.isPending ||
    convertToZoneMutation.isPending ||
    duplicateMutation.isPending;
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
      initialWorkLocationType: assignment.workLocationType,
      supervisorId: assignment.supervisorId,
      supervisorIds: [assignment.supervisorId],
      projectId: assignment.projectId ?? sites.find((site) => site.id === assignment.siteId)?.project.id ?? '',
      zoneId: '',
      siteId: assignment.siteId ?? '',
      date: selectedDate,
      action: assignment.action,
      targetProgress: assignment.targetProgress === null ? '' : String(assignment.targetProgress),
      targetQuantity: assignment.targetQuantity === null ? '' : String(assignment.targetQuantity),
      targetUnit: assignment.targetUnit ?? '',
      objectiveText: assignment.objectiveText ?? '',
      plannedDurationMinutes: assignment.plannedDurationMinutes === null ? '' : String(assignment.plannedDurationMinutes),
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
    const plannedDurationMinutes = form.plannedDurationMinutes === '' ? null : Number(form.plannedDurationMinutes);
    const normalizedTargetProgress = targetQuantity !== null && targetQuantity > 0 ? null : targetProgress;
    const targetUnit = form.targetUnit.trim() || null;

    if (form.workLocationType === PlanningWorkLocationType.FREE_MISSION) {
      if (drawerMode === 'edit' && form.id && form.initialWorkLocationType !== PlanningWorkLocationType.FREE_MISSION) {
        if (viewer.role === 'NEGOTIATION_MANAGER') {
          convertToZoneMutation.mutate({
            sourceAssignmentId: form.id,
            date: form.date,
            type: 'NEGOTIATION_ZONE',
            data: {
              date: form.date,
              projectId: form.projectId,
              assigneeIds: [form.supervisorId],
              zoneId: form.zoneId || null,
              plannedZone: (negotiationZones.find((zone) => zone.id === form.zoneId)?.name ?? form.action.trim()) || null,
              instruction: form.action.trim() || null,
            },
          });
          return;
        }

        const data: FreeMissionWebRequest = {
          projectId: form.projectId,
          assigneeId: form.supervisorId,
          date: form.date,
          action: form.action,
          targetProgress: normalizedTargetProgress,
          targetQuantity,
          targetUnit,
          objectiveText: form.objectiveText.trim() || null,
          plannedDurationMinutes,
        };
        convertToZoneMutation.mutate({ sourceAssignmentId: form.id, date: form.date, type: 'FREE_MISSION', data });
        return;
      }

      if (viewer.role === 'NEGOTIATION_MANAGER' && drawerMode === 'create') {
        negotiationZoneMutation.mutate({
          date: form.date,
          projectId: form.projectId,
          assigneeIds: form.supervisorIds,
          zoneId: form.zoneId || null,
          plannedZone: (negotiationZones.find((zone) => zone.id === form.zoneId)?.name ?? form.action.trim()) || null,
          instruction: form.action.trim() || null,
        });
        return;
      }

      const data: FreeMissionWebRequest = {
        projectId: form.projectId,
        assigneeId: form.supervisorId,
        ...(drawerMode === 'create' ? { assigneeIds: form.supervisorIds } : {}),
        date: form.date,
        action: form.action,
        targetProgress: normalizedTargetProgress,
        targetQuantity,
        targetUnit,
        objectiveText: form.objectiveText.trim() || null,
        plannedDurationMinutes,
      };
      freeMissionMutation.mutate(drawerMode === 'edit' && form.id ? { id: form.id, data } : { data });
      return;
    }

    if (drawerMode === 'create') {
      const payload: PlanningWebCreateRequest = {
        supervisorId: form.supervisorId,
        supervisorIds: form.supervisorIds,
        siteId: form.workLocationType === PlanningWorkLocationType.ON_SITE ? form.siteId : null,
        projectId: form.projectId || null,
        action: form.action,
        targetProgress: normalizedTargetProgress,
        targetQuantity,
        targetUnit,
        objectiveText: form.objectiveText.trim() || null,
        plannedDurationMinutes,
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
          plannedDurationMinutes,
          status: form.status,
          workLocationType: form.workLocationType,
        },
      });
    }
  }

  function duplicateSelectedDay() {
    if (duplicateTargetDate === selectedDate) {
      pushToast({
        type: 'error',
        title: 'Date cible invalide',
        message: 'Choisis une date différente du jour source.',
      });
      return;
    }

    duplicateMutation.mutate({
      sourceDate: selectedDate,
      targetDate: duplicateTargetDate,
    });
  }

  function pushMutationError(error: unknown, title: string) {
    pushToast({
      type: 'error',
      title,
      message: error instanceof Error ? error.message : 'Opération refusée.',
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
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Tâches journalières</h1>
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
              <SearchableSelect
                onChange={(value) => setFilter('projectId', value)}
                options={dayProjectSelectOptions}
                placeholder="Tous les projets"
                value={filters.projectId}
              />
            </Field>
            <Field label="Chantier">
              <SearchableSelect
                onChange={(value) => setFilter('siteId', value)}
                options={daySiteSelectOptions}
                placeholder="Tous les chantiers"
                value={filters.siteId}
              />
            </Field>
            <Field label="Ressource">
              <SearchableSelect
                onChange={(value) => setFilter('resourceId', value)}
                options={dayResourceSelectOptions}
                placeholder="Toutes les ressources"
                value={filters.resourceId}
              />
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
                Centralisé
              </SegmentedButton>
            ) : null}
          </div>
        </div>
        ) : null}
      </section>

      {viewMode === 'centralized' ? (
        <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
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
              <SearchableSelect
                onChange={(value) => setCentralizedFilter('projectId', value)}
                options={centralizedProjectSelectOptions}
                placeholder="Tous les projets"
                value={centralizedFilters.projectId}
              />
            </Field>
            <Field label="Chef projet">
              <SearchableSelect
                onChange={(value) => setCentralizedFilter('projectManagerId', value)}
                options={centralizedProjectManagerSelectOptions}
                placeholder="Tous les chefs projets"
                value={centralizedFilters.projectManagerId}
              />
            </Field>
            <Field label="Chantier">
              <SearchableSelect
                onChange={(value) => setCentralizedFilter('siteId', value)}
                options={centralizedSiteSelectOptions}
                placeholder="Tous les chantiers"
                value={centralizedFilters.siteId}
              />
            </Field>
            <Field label="Ressource">
              <SearchableSelect
                onChange={(value) => setCentralizedFilter('resourceId', value)}
                options={centralizedResourceSelectOptions}
                placeholder="Toutes les ressources"
                value={centralizedFilters.resourceId}
              />
            </Field>
            <Field label="Rôle">
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
                    {workLocationTypeLabel[type]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </section>
      ) : null}

      {data && viewMode !== 'centralized' ? (
        <section className="grid gap-4 md:grid-cols-4">
          <MetricCard label="Tâches" value={data.assignments.length} />
          <MetricCard label="Ressources actives" value={data.unassignedSupervisors.length} />
          <MetricCard label="Chantiers accessibles" value={data.availableSites.length} />
          <MetricCard label="Affichées" value={filteredAssignments.length} />
        </section>
      ) : null}

      {canMutate && data && viewMode !== 'centralized' ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Actions planning</h2>
            <p className="mt-1 text-sm text-slate-600">Crée une tâche pour une ressource terrain.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              disabled={isMutating}
              onClick={() => void downloadPlanningExport(selectedDate, filters, 'xlsx', pushMutationError)}
              type="button"
            >
              <Download className="h-4 w-4" />
              Récap Excel
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              disabled={isMutating}
              onClick={() => void downloadPlanningExport(selectedDate, filters, 'pdf', pushMutationError)}
              type="button"
            >
              <Download className="h-4 w-4" />
              Récap PDF
            </button>
            <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                Dupliquer vers
                <input
                  className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold normal-case tracking-normal text-slate-900 outline-none transition focus:border-orange-500"
                  onChange={(event) => setDuplicateTargetDate(event.target.value)}
                  type="date"
                  value={duplicateTargetDate}
                />
              </label>
              <button
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                disabled={isMutating || (data.assignments.length ?? 0) === 0 || !duplicateTargetDate}
                onClick={duplicateSelectedDay}
                type="button"
              >
              <Copy className="h-4 w-4" />
              {duplicateMutation.isPending ? 'Duplication...' : 'Dupliquer'}
              </button>
            </div>
            <button
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              disabled={isMutating}
              onClick={() => setPlanningImportOpen(true)}
              type="button"
            >
              <Upload className="h-4 w-4" />
              Importer un planning
            </button>
            <button className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60" disabled={isMutating} onClick={() => openCreate()} type="button">
              Ajouter une tâche
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
          isNegotiationManager={viewer.role === 'NEGOTIATION_MANAGER'}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
          mode={drawerMode}
          negotiationZones={negotiationZones}
          projects={projects}
          resources={resources}
          sites={sites}
          onCancel={closeDrawer}
          onChange={setForm}
          onSaveTemplate={(name) => saveTemplateMutation.mutate({ name, form })}
          onSubmit={submitForm}
          conflicts={assignmentConflicts}
          templates={templatesQuery.data?.items ?? []}
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

      {planningImportOpen ? (
        <PlanningImportModal
          commitMutation={planningImportCommitMutation}
          preview={planningImportPreviewMutation.data ?? null}
          previewMutation={planningImportPreviewMutation}
          onClose={() => setPlanningImportOpen(false)}
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
              <Badge tone="info">{group.assignments.length} tâche(s)</Badge>
              <Badge tone="neutral">{officeCount} bureau</Badge>
              {blockedCount > 0 ? <Badge tone="error">{blockedCount} bloquée(s)</Badge> : null}
            </div>
          </div>

          <div className="space-y-2 bg-slate-50/60 p-3">
            {group.assignments.map((assignment) => {
              const site = sites.find((item) => item.id === assignment.siteId);
              return (
                <CompactPlanningTaskRow
                  assignment={assignment}
                  canMutate={canMutate}
                  key={assignment.id}
                  onDelete={onDelete}
                  onEdit={onEdit}
                  projectName={site?.project.name ?? assignment.projectName ?? '-'}
                  showInterventionZone={site?.siteType === 'INTERVENTION_ZONE'}
                />
              );
            })}
          </div>
        </article>
        );
      })}
    </section>
  );
}

function CompactPlanningTaskRow({
  assignment,
  canMutate,
  onDelete,
  onEdit,
  projectName,
  showInterventionZone,
}: Readonly<{
  assignment: PlanningWebAssignment;
  canMutate: boolean;
  onDelete: (assignment: PlanningWebAssignment) => void;
  onEdit: (assignment: PlanningWebAssignment) => void;
  projectName: string;
  showInterventionZone: boolean;
}>) {
  const config = objectiveStatusConfig[assignment.objectiveStatus];
  const progressValue = Math.max(0, Math.min(100, assignment.actualProgress ?? assignment.targetProgress ?? 0));
  const progressLabel = assignment.targetQuantity && assignment.targetQuantity > 0
    ? `${formatQuantity(assignment.actualQuantity ?? 0)} / ${formatQuantity(assignment.targetQuantity)} ${assignment.targetUnit ?? ''}`.trim()
    : assignment.actualProgress !== null || assignment.targetProgress !== null
      ? `${progressValue}%`
      : 'Aucun avancement';

  return (
    <div className="grid gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm transition hover:border-slate-200 hover:bg-slate-50/60 lg:grid-cols-[minmax(0,1.35fr)_minmax(220px,0.75fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="px-2.5 py-0.5 text-[10px]" tone={assignment.workLocationType === 'OFFICE' ? 'neutral' : assignment.workLocationType === 'FREE_MISSION' ? 'warning' : 'info'}>
            {workLocationTypeLabel[assignment.workLocationType]}
          </Badge>
          {assignment.siteType === 'FREE_MISSION' ? <Badge className="px-2.5 py-0.5 text-[10px]" tone="warning">Sans chantier fixe</Badge> : null}
          {showInterventionZone ? <Badge className="px-2.5 py-0.5 text-[10px]" tone="success">Zone d&apos;intervention</Badge> : null}
          <Badge className="px-2.5 py-0.5 text-[10px]" tone={statusTone(assignment.status)}>{planningStatusLabel[assignment.status]}</Badge>
        </div>
        <p className="mt-2 line-clamp-2 text-sm font-bold leading-5 text-slate-950">{assignment.action}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
          <span className="font-bold uppercase tracking-[0.12em] text-slate-400">{projectName}</span>
          <span className="hidden text-slate-300 sm:inline">/</span>
          <span className="truncate font-semibold">{assignment.siteName}</span>
          {assignment.siteAddress ? <span className="truncate text-slate-400">{assignment.siteAddress}</span> : null}
        </div>
        {assignment.objectiveText ? <p className="mt-1 line-clamp-1 text-xs text-slate-500">Consigne : {assignment.objectiveText}</p> : null}
      </div>

      <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-xs font-bold text-slate-700">{progressLabel}</span>
          <Badge className="px-2.5 py-0.5 text-[10px]" tone={config.tone}>{config.label}</Badge>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
          <div className={`h-full rounded-full ${objectiveBarClassName(config.tone)}`} style={{ width: `${progressValue}%` }} />
        </div>
        {assignment.latestProgressUpdate?.comment ? (
          <p className="mt-1 line-clamp-1 text-xs text-slate-500">{assignment.latestProgressUpdate.comment}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 lg:justify-end">
        <p className="truncate text-xs text-slate-400 lg:max-w-28">
          Créé par {assignment.createdBy.firstName} {assignment.createdBy.lastName}
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
                    {workLocationTypeLabel[assignment.workLocationType]}
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
        title="Planning centralisé indisponible"
        description="La vue centralisée n'a pas pu etre chargée. Vérifie ta session puis réessaie."
      />
    );
  }

  if (items.length === 0) {
    return <EmptyState title="Aucune affectation" description="Aucune ligne ne correspond aux filtres centralisés." />;
  }

  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-panel">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Planning centralisé</h2>
            <p className="mt-1 text-sm text-slate-600">Lecture globale des affectations pour arbitrer les disponibilités.</p>
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
              <th className="px-5 py-3">Tâche</th>
              <th className="px-5 py-3">Type</th>
              <th className="px-5 py-3">Progression</th>
              <th className="px-5 py-3">Statut</th>
              <th className="px-5 py-3">Créateur</th>
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
                    {workLocationTypeLabel[item.workLocationType]}
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
            placeholder="Rechercher une ressource par nom, email ou disponibilité..."
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
            Aucune ressource ne correspond à  cette recherche.
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
  negotiationZones,
  isNegotiationManager,
  resources,
  conflicts,
  templates,
  canEditIdentity,
  isSubmitting,
  onChange,
  onCancel,
  onSaveTemplate,
  onSubmit,
}: Readonly<{
  mode: DrawerMode;
  form: AssignmentFormState;
  projects: { id: string; name: string }[];
  sites: AvailableSite[];
  negotiationZones: AvailableNegotiationZone[];
  isNegotiationManager: boolean;
  resources: UnassignedSupervisor[];
  conflicts: CentralizedPlanningAssignment[];
  templates: PlanningTaskTemplateItem[];
  canEditIdentity: boolean;
  isSubmitting: boolean;
  onChange: (form: AssignmentFormState) => void;
  onCancel: () => void;
  onSaveTemplate: (name: string) => void;
  onSubmit: () => void;
}>) {
  const [templateName, setTemplateName] = useState('');
  const projectOptions = toProjectSelectOptions(projects);
  const siteOptions = toSiteSelectOptions(sites.filter((site) => !form.projectId || site.project.id === form.projectId));
  const negotiationZoneOptions = toNegotiationZoneSelectOptions(negotiationZones.filter((zone) => !form.projectId || zone.projectId === form.projectId));
  const resourceOptions = toResourceSelectOptions(resources);
  const templateOptions = templates.map((template) => ({
    value: template.id,
    label: template.name,
    description: template.action,
  }));
  const progressNumber = form.targetProgress === '' ? null : Number(form.targetProgress);
  const quantityNumber = form.targetQuantity === '' ? null : Number(form.targetQuantity);
  const hasQuantityObjective = quantityNumber !== null && quantityNumber > 0;
  const isFreeMission = form.workLocationType === PlanningWorkLocationType.FREE_MISSION;
  const isOfficeTask = form.workLocationType === PlanningWorkLocationType.OFFICE;
  const isNegotiationZone = isFreeMission && isNegotiationManager;
  const isZoneConversion = mode === 'edit' && form.initialWorkLocationType !== PlanningWorkLocationType.FREE_MISSION && isFreeMission;
  const canEditZoneIdentity = mode === 'create' || isZoneConversion;
  const projectNegotiationZones = negotiationZones.filter((zone) => zone.projectId === form.projectId);
  const zoneSelectionRequired = isNegotiationZone && projectNegotiationZones.length > 0;
  const progressValid = progressNumber === null || (Number.isInteger(progressNumber) && progressNumber >= 0 && progressNumber <= 100);
  const quantityValid = quantityNumber === null || (Number.isFinite(quantityNumber) && quantityNumber >= 0);
  const canSubmit = Boolean(form.action.trim() && form.date) && progressValid && quantityValid;
  const selectedResourceCount = mode === 'create' ? form.supervisorIds.length : form.supervisorId ? 1 : 0;
  const createIdentityValid =
    (mode === 'edit' && !isZoneConversion) ||
    Boolean(
      selectedResourceCount > 0 &&
        (isNegotiationZone
          ? form.projectId && (!zoneSelectionRequired || form.zoneId)
          : isFreeMission || isOfficeTask
            ? form.projectId
            : form.siteId),
    );

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
          {mode === 'create' && templates.length > 0 ? (
            <Field label="Utiliser un modèle">
              <SearchableSelect
                allowClear={false}
                emptyLabel="Aucun modèle trouvé."
                onChange={(value) => {
                  const template = templates.find((item) => item.id === value);
                  if (!template) return;
                  onChange(applyTemplateToForm(form, template));
                }}
                options={templateOptions}
                placeholder="Rechercher un modèle"
                value=""
              />
            </Field>
          ) : null}
          <Field label="Date">
            <input
              className={filterClassName}
              disabled={!canEditIdentity}
              onChange={(event) => onChange({ ...form, date: event.target.value })}
              type="date"
              value={form.date}
            />
          </Field>
          <Field label="Type de tâche">
            <select
              className={filterClassName}
              disabled={mode === 'edit' && form.initialWorkLocationType === PlanningWorkLocationType.FREE_MISSION}
              onChange={(event) => {
                const workLocationType = event.target.value as PlanningWorkLocationType;
                onChange({
                  ...form,
                  workLocationType,
                  zoneId: workLocationType === PlanningWorkLocationType.FREE_MISSION ? form.zoneId : '',
                  siteId: workLocationType === PlanningWorkLocationType.ON_SITE ? form.siteId : '',
                });
              }}
              value={form.workLocationType}
            >
              {creatableWorkLocationTypes.map((type) => (
                <option key={type} value={type}>
                  {workLocationTypeLabel[type]}
                </option>
              ))}
            </select>
            <p className="mt-2 text-xs font-semibold text-slate-500">
              {mode === 'edit' && form.initialWorkLocationType === PlanningWorkLocationType.FREE_MISSION
                ? 'Une zone existante reste une zone. Retire-la puis recrée une tâche chantier si nécessaire.'
                : 'Choisis d&apos;abord le type. Une tâche bureau organise le travail, mais la présence reste enregistrée avec le pointage bureau.'}
            </p>
          </Field>
          <Field label={mode === 'create' ? 'Ressources' : 'Ressource'}>
            {mode === 'create' ? (
              <SearchableMultiSelect
                disabled={!canEditIdentity}
                emptyLabel="Aucune ressource trouvée."
                onChange={(values) => onChange({ ...form, supervisorIds: values, supervisorId: values[0] ?? '' })}
                options={resourceOptions}
                placeholder="Rechercher des ressources"
                values={form.supervisorIds}
              />
            ) : (
              <SearchableSelect
                disabled
                emptyLabel="Aucune ressource trouvée."
                onChange={(value) => onChange({ ...form, supervisorId: value, supervisorIds: value ? [value] : [] })}
                options={resourceOptions}
                placeholder="Ressource"
                value={form.supervisorId}
              />
            )}
            {mode === 'create' && form.supervisorIds.length > 1 ? (
              <p className="mt-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                {form.supervisorIds.length} tâches identiques seront créées, une par ressource.
              </p>
            ) : null}
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
            <SearchableSelect
              disabled={!canEditIdentity && !isZoneConversion}
              emptyLabel="Aucun projet trouvé."
              onChange={(value) => onChange({ ...form, projectId: value, zoneId: '', siteId: '' })}
              options={projectOptions}
              placeholder="Tous les projets"
              value={form.projectId}
            />
          </Field>
          {form.workLocationType === PlanningWorkLocationType.ON_SITE ? (
            <Field label="Chantier">
              <SearchableSelect
                disabled={!canEditIdentity}
                emptyLabel="Aucun chantier trouvé."
                onChange={(value) => {
                  const nextSite = sites.find((site) => site.id === value);
                  onChange({ ...form, siteId: value, projectId: nextSite?.project.id ?? form.projectId });
                }}
                options={siteOptions}
                placeholder="Rechercher un chantier"
                value={form.siteId}
              />
            </Field>
          ) : isOfficeTask ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-600">
              Bureau : sélectionne seulement le projet. La présence sera enregistrée au bureau, sans choix de chantier.
            </div>
          ) : isNegotiationZone ? (
            <Field label="Zone">
              <SearchableSelect
                disabled={!canEditZoneIdentity || !form.projectId}
                emptyLabel={form.projectId ? 'Aucune zone trouvée. Importe les scopes du projet pour créer les zones.' : 'Choisis un projet.'}
                onChange={(value) => {
                  const zone = negotiationZones.find((item) => item.id === value);
                  onChange({
                    ...form,
                    zoneId: value,
                    projectId: zone?.projectId ?? form.projectId,
                  });
                }}
                options={negotiationZoneOptions}
                placeholder="Rechercher une zone"
                value={form.zoneId}
              />
              {zoneSelectionRequired && !form.zoneId ? (
                <p className="mt-2 text-xs font-semibold text-red-600">
                  Ce projet contient des zones : sélectionne obligatoirement la zone à planifier.
                </p>
              ) : null}
              <p className="mt-2 text-xs font-semibold text-slate-500">
                La ressource pointera cette zone puis verra les scopes de la zone dans Négociation.
              </p>
            </Field>
          ) : (
            <div className="rounded-2xl border border-orange-100 bg-orange-50 p-3 text-xs font-semibold text-orange-800">
              Zone sans chantier fixe : la ressource pointera avec sa position GPS reelle.
            </div>
          )}
          <Field label="Tâche à  réaliser">
            <textarea
              className={`${filterClassName} min-h-32`}
              onChange={(event) => onChange({ ...form, action: event.target.value })}
              value={form.action}
            />
          </Field>
          <Field label="Durée prévue (minutes)">
            <input
              className={filterClassName}
              min={0}
              onChange={(event) => onChange({ ...form, plannedDurationMinutes: event.target.value })}
              placeholder="Ex : 120"
              type="number"
              value={form.plannedDurationMinutes}
            />
            <p className="mt-2 text-xs font-semibold text-slate-500">
              Sert au suivi de charge, de retard et de progression projet.
            </p>
          </Field>
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
          {hasQuantityObjective ? (
            <div className="rounded-2xl border border-sky-100 bg-sky-50 p-3 text-xs font-semibold text-sky-800">
              La progression sera calculee depuis la quantite realisee. La progression cible % est ignoree pour cette tache.
            </div>
          ) : (
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
          )}
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
          {mode === 'create' ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-black text-slate-800">Enregistrer comme modèle</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  className={`${filterClassName} bg-white`}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="Nom du modèle"
                  value={templateName}
                />
                <button
                  className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!templateName.trim() || !form.action.trim()}
                  onClick={() => {
                    onSaveTemplate(templateName);
                    setTemplateName('');
                  }}
                  type="button"
                >
                  Enregistrer
                </button>
              </div>
              <p className="mt-2 text-xs font-semibold text-slate-500">
                Le modèle garde l&apos;action, la consigne, l&apos;objectif, l&apos;unité et la durée prévue.
              </p>
            </div>
          ) : null}
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

function MetricCard({ label, value }: Readonly<{ label: string; value: number | string }>) {
  return (
    <article className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-slate-950">{value}</p>
    </article>
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

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="h-28 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
      <div className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
    </div>
  );
}

function PlanningImportModal({
  preview,
  previewMutation,
  commitMutation,
  onClose,
}: Readonly<{
  preview: PlanningImportPreviewResponse | null;
  previewMutation: {
    isPending: boolean;
    mutate: (file: File) => void;
  };
  commitMutation: {
    isPending: boolean;
    mutate: (rows: PlanningImportPreviewRow[]) => void;
    data?: PlanningImportCommitResponse | undefined;
  };
  onClose: () => void;
}>) {
  const [file, setFile] = useState<File | null>(null);
  const validRows = preview?.rows.filter((row) => row.valid) ?? [];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50">
      <div className="custom-scrollbar absolute inset-x-4 top-6 bottom-6 overflow-auto rounded-[2rem] bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.28)] lg:inset-x-16">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-600">Import planning</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">Importer un planning Excel</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Détection automatique des fichiers “par ressource” et “objectifs projet”. Les lignes invalides restent ignorées.
            </p>
          </div>
          <button className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" onClick={onClose} type="button">
            Fermer
          </button>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <article className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">1. Modèle</p>
            <p className="mt-2 text-sm text-slate-600">Télécharge le modèle recommandé pour les futurs imports.</p>
            <a className="mt-4 inline-flex rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800" href="/api/planning/import/template">
              Télécharger le modèle
            </a>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">2. Fichier</p>
            <input
              accept=".xlsx"
              className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              type="file"
            />
            <button
              className="mt-4 rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!file || previewMutation.isPending}
              onClick={() => file && previewMutation.mutate(file)}
              type="button"
            >
              {previewMutation.isPending ? 'Analyse...' : 'Prévisualiser'}
            </button>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">3. Import</p>
            <p className="mt-2 text-sm text-slate-600">Importe uniquement les lignes valides détectées par la prévisualisation.</p>
            <button
              className="mt-4 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={validRows.length === 0 || commitMutation.isPending}
              onClick={() => commitMutation.mutate(validRows)}
              type="button"
            >
              {commitMutation.isPending ? 'Import...' : 'Importer les lignes valides'}
            </button>
          </article>
        </div>

        {preview ? (
          <div className="mt-6 space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <MetricCard label="Format" value={preview.detectedFormat === 'RESOURCE_ROWS' ? 'Ressources' : 'Objectifs projet'} />
              <MetricCard label="Total lignes" value={preview.totalRows} />
              <MetricCard label="Valides" value={preview.validRows} />
              <MetricCard label="Erreurs" value={preview.errorRows} />
            </div>

            <div className="overflow-hidden rounded-3xl border border-slate-200">
              <div className="custom-scrollbar max-h-[48vh] overflow-auto">
                <table className="min-w-[1180px] divide-y divide-slate-200 text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Ligne</th>
                      <th className="px-4 py-3">Statut</th>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Date / Projet</th>
                      <th className="px-4 py-3">Ressource / Localité</th>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">Messages</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {preview.rows.map((row) => (
                      <tr key={row.id}>
                        <td className="px-4 py-3 font-semibold text-slate-900">{row.sheetName} · {row.rowNumber}</td>
                        <td className="px-4 py-3">
                          <Badge tone={row.valid ? 'success' : 'error'}>{row.valid ? 'Valide' : 'Erreur'}</Badge>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {row.kind === 'RESOURCE_ROW'
                            ? row.suggestedWorkLocationType === 'ON_SITE'
                              ? 'Chantier'
                              : row.suggestedWorkLocationType === 'OFFICE'
                                ? 'Bureau'
                                : 'Zone'
                            : 'Modèle'}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {row.kind === 'RESOURCE_ROW' ? (
                            <>
                              <p className="font-semibold text-slate-900">{row.date ?? '-'}</p>
                              <p>{row.projectLabel || '-'}</p>
                            </>
                          ) : (
                            <>
                              <p className="font-semibold text-slate-900">{row.projectLabel || '-'}</p>
                              <p>{row.locality || '-'}</p>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {row.kind === 'RESOURCE_ROW' ? (
                            <>
                              <p className="font-semibold text-slate-900">{row.resourceLabel || '-'}</p>
                              <p>{row.locationLabel || '-'}</p>
                            </>
                          ) : (
                            <p className="font-semibold text-slate-900">{row.locality || '-'}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <p className="font-semibold text-slate-900">{row.action}</p>
                          {row.kind === 'PROJECT_TEMPLATE_ROW' && row.targetQuantity !== null ? (
                            <p>{row.targetQuantity} {row.targetUnit ?? ''}</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {row.errors.length > 0 ? (
                            <div className="space-y-1">
                              {row.errors.map((message) => (
                                <p className="text-xs font-semibold text-red-600" key={message}>{message}</p>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs font-semibold text-emerald-700">Prêt pour import</p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {commitMutation.data ? (
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                {commitMutation.data.createdAssignmentsCount} tâche(s) chantier/bureau, {commitMutation.data.createdFreeMissionsCount} zone(s), {commitMutation.data.createdTemplatesCount} modèle(s). {commitMutation.data.skippedCount} ligne(s) ignorée(s).
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
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
  if (filters.projectManagerId) searchParams.set('projectManagerId', filters.projectManagerId);

  const response = await authFetch(`/api/planning/centralized?${searchParams.toString()}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de charger le planning centralisé.'));
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
    throw new Error(await getApiErrorMessage(response, 'Impossible de créer la tâche.'));
  }
  return (await response.json()) as PlanningWebMutationResponse;
}

async function fetchPlanningTemplates(): Promise<PlanningTaskTemplatesResponse> {
  const response = await authFetch('/api/planning/templates', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Modèles planning indisponibles.'));
  }

  return (await response.json()) as PlanningTaskTemplatesResponse;
}

async function previewPlanningImportFile(file: File) {
  const formData = new FormData();
  formData.set('file', file);
  const response = await authFetch('/api/planning/import/preview', {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Prévisualisation planning impossible.'));
  }
  return (await response.json()) as PlanningImportPreviewResponse;
}

async function commitPlanningImportRows(rows: PlanningImportPreviewRow[]) {
  const response = await authFetch('/api/planning/import/commit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Import planning impossible.'));
  }
  return (await response.json()) as PlanningImportCommitResponse;
}

async function savePlanningTemplate({ name, form }: { name: string; form: AssignmentFormState }) {
  const targetQuantity = form.targetQuantity === '' ? null : Number(form.targetQuantity);
  const plannedDurationMinutes = form.plannedDurationMinutes === '' ? null : Number(form.plannedDurationMinutes);
  const targetProgress = targetQuantity !== null && targetQuantity > 0 ? null : form.targetProgress === '' ? null : Number(form.targetProgress);
  const response = await authFetch('/api/planning/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      action: form.action,
      targetProgress,
      targetQuantity,
      targetUnit: form.targetUnit.trim() || null,
      objectiveText: form.objectiveText.trim() || null,
      plannedDurationMinutes,
      workLocationType: form.workLocationType,
    }),
  });

  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Modèle planning impossible.'));
  }
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

async function createFreeMission(data: FreeMissionWebRequest) {
  const response = await authFetch('/api/free-missions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de creer la mission libre.'));
  }
  return (await response.json()) as CreateSummaryResponse;
}

async function createNegotiationZoneAssignments(data: NegotiationZonePlanningRequest) {
  const response = await authFetch('/api/negotiation/assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de creer la zone negociation.'));
  }
  return (await response.json()) as CreateSummaryResponse;
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
  return (await response.json()) as CreateSummaryResponse;
}

async function convertAssignmentToZone(request: ConvertToZoneRequest) {
  const result =
    request.type === 'NEGOTIATION_ZONE'
      ? await createNegotiationZoneAssignments(request.data)
      : await createFreeMission(request.data);

  if (result.createdCount !== undefined && result.createdCount <= 0) {
    throw new Error('Aucune zone nouvelle creee. La tache chantier est conservee.');
  }

  await deleteAssignment(request.sourceAssignmentId);
  return result;
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

async function deleteAssignment(id: string) {
  const response = await authFetch(`/api/planning/assignments/${id}`, { method: 'DELETE' });
  if (response.status === 404) {
    const freeMissionResponse = await authFetch(`/api/free-missions/${id}`, { method: 'DELETE' });
    if (freeMissionResponse.status === 404) {
      const negotiationResponse = await authFetch(`/api/negotiation/assignments/${id}`, { method: 'DELETE' });
      if (!negotiationResponse.ok) {
        throw new Error(await getApiErrorMessage(negotiationResponse, 'Impossible de supprimer la mission negociation.'));
      }
      return;
    }

    if (!freeMissionResponse.ok) {
      throw new Error(await getApiErrorMessage(freeMissionResponse, 'Impossible de supprimer la mission libre.'));
    }
    return;
  }
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de supprimer la tâche.'));
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
  const projectManagers = new Map<string, string>();
  const roles = new Set<Role>();

  for (const item of items) {
    projects.set(item.projectId, item.projectName);
    sites.set(item.siteId, { id: item.siteId, name: item.siteName, projectId: item.projectId });
    resources.set(item.resourceId, item.resourceName);
    projectManagers.set(item.projectManagerId, item.projectManagerName);
    roles.add(item.resourceRole);
  }

  return {
    projects: [...projects.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    sites: [...sites.values()].sort((a, b) => a.name.localeCompare(b.name)),
    resources: [...resources.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    projectManagers: [...projectManagers.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
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

function formatCreateSuccessTitle(result: CreateSummaryResponse, fallback: string) {
  const createdCount = result.createdCount;
  const skippedCount = result.skippedCount ?? 0;
  if (typeof createdCount !== 'number') {
    return fallback;
  }

  if (skippedCount > 0) {
    return `${createdCount} créée(s), ${skippedCount} déjà existante(s)`;
  }

  return `${createdCount} créée(s)`;
}

function toProjectSelectOptions(projects: { id: string; name: string }[]): SearchableSelectOption[] {
  return projects.map((project) => ({
    value: project.id,
    label: project.name,
  }));
}

function toSiteSelectOptions(sites: AvailableSite[]): SearchableSelectOption[] {
  return sites.map((site) => ({
    value: site.id,
    label: site.name,
    description: site.project.name,
    keywords: `${site.address} ${site.project.name}`,
  }));
}

function toNegotiationZoneSelectOptions(zones: AvailableNegotiationZone[]): SearchableSelectOption[] {
  return zones.map((zone) => ({
    value: zone.id,
    label: zone.name,
    description: `${zone.scopeCount} scope(s) - ${zone.project.name}`,
    keywords: `${zone.city ?? ''} ${zone.region ?? ''} ${zone.project.name}`,
  }));
}

function toResourceSelectOptions(resources: UnassignedSupervisor[]): SearchableSelectOption[] {
  return resources.map((resource) => ({
    value: resource.id,
    label: `${resource.firstName} ${resource.name}`,
    description: resource.availabilityLabel,
    keywords: `${resource.email ?? ''} ${resource.availabilityLabel}`,
  }));
}

function createEmptyForm(date: string): AssignmentFormState {
  return {
    supervisorId: '',
    supervisorIds: [],
    projectId: '',
    zoneId: '',
    siteId: '',
    date,
    action: '',
    targetProgress: '',
    targetQuantity: '',
    targetUnit: '',
    objectiveText: '',
    plannedDurationMinutes: '',
    status: PlanningAssignmentStatus.ASSIGNED,
    workLocationType: PlanningWorkLocationType.ON_SITE,
  };
}

function applyTemplateToForm(form: AssignmentFormState, template: PlanningTaskTemplateItem): AssignmentFormState {
  return {
    ...form,
    action: template.action,
    targetProgress: template.targetProgress === null ? '' : String(template.targetProgress),
    targetQuantity: template.targetQuantity ?? '',
    targetUnit: template.targetUnit ?? '',
    objectiveText: template.objectiveText ?? '',
    plannedDurationMinutes: template.plannedDurationMinutes === null ? '' : String(template.plannedDurationMinutes),
    workLocationType: template.workLocationType,
    zoneId: template.workLocationType === PlanningWorkLocationType.FREE_MISSION ? form.zoneId : '',
    siteId: template.workLocationType === PlanningWorkLocationType.ON_SITE ? form.siteId : '',
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

function objectiveBarClassName(tone: (typeof objectiveStatusConfig)[keyof typeof objectiveStatusConfig]['tone']) {
  if (tone === 'success') return 'bg-emerald-500';
  if (tone === 'warning') return 'bg-orange-500';
  if (tone === 'error') return 'bg-red-500';
  return 'bg-slate-400';
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
