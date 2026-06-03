'use client';

import { GeneralSupervisorSiteScopeStatus, type Role } from '@prisma/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Pencil, UserRoundX } from 'lucide-react';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { SearchableSelect, type SearchableSelectOption } from '@/components/searchable-select';
import { TableActionsMenu } from '@/components/table-actions-menu';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import type {
  CreateGeneralSupervisorScopeRequest,
  GeneralSupervisorScopeItem,
  GeneralSupervisorScopesResponse,
  GeneralSupervisorScopeSiteOption,
  GeneralSupervisorScopeUserOption,
  UpdateGeneralSupervisorScopeRequest,
} from '@/types/general-supervisor-scopes';

type GeneralSupervisorScopesWebPageProps = Readonly<{
  viewer: {
    role: Role;
  };
}>;

type ScopeFilters = {
  projectId: string;
  siteId: string;
  generalSupervisorId: string;
  status: 'ALL' | GeneralSupervisorSiteScopeStatus;
};

type ScopeFormState = {
  id?: string;
  generalSupervisorId: string;
  projectId: string;
  siteId: string;
  startDate: string;
  endDate: string;
  status: GeneralSupervisorSiteScopeStatus;
};

const todayKey = new Date().toISOString().slice(0, 10);
const emptyScopes: GeneralSupervisorScopeItem[] = [];
const emptySites: GeneralSupervisorScopeSiteOption[] = [];
const emptyGeneralSupervisors: GeneralSupervisorScopeUserOption[] = [];
const inputClassName =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-500';
const secondaryButtonClassName =
  'rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';

export function GeneralSupervisorScopesWebPage({ viewer }: GeneralSupervisorScopesWebPageProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const canMutate = viewer.role === 'PROJECT_MANAGER' || viewer.role === 'ADMIN';
  const [filters, setFilters] = useState<ScopeFilters>({
    projectId: '',
    siteId: '',
    generalSupervisorId: '',
    status: 'ALL',
  });
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit' | null>(null);
  const [form, setForm] = useState<ScopeFormState>(() => createEmptyForm());
  const [deleteTarget, setDeleteTarget] = useState<GeneralSupervisorScopeItem | null>(null);

  const scopesQuery = useQuery({
    queryKey: ['web-general-supervisor-scopes'],
    queryFn: fetchScopes,
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: createScope,
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Perimetre cree' });
      closeDrawer();
      await queryClient.invalidateQueries({ queryKey: ['web-general-supervisor-scopes'] });
    },
    onError: (error) => pushError('Creation impossible', error),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateGeneralSupervisorScopeRequest }) => updateScope(id, data),
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Perimetre mis a jour' });
      closeDrawer();
      await queryClient.invalidateQueries({ queryKey: ['web-general-supervisor-scopes'] });
    },
    onError: (error) => pushError('Modification impossible', error),
  });

  const deactivateMutation = useMutation({
    mutationFn: deactivateScope,
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Perimetre desactive' });
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['web-general-supervisor-scopes'] });
    },
    onError: (error) => pushError('Desactivation impossible', error),
  });

  const data = scopesQuery.data;
  const scopes = data?.scopes ?? emptyScopes;
  const sites = data?.sites ?? emptySites;
  const generalSupervisors = data?.generalSupervisors ?? emptyGeneralSupervisors;
  const projects = useMemo(() => getProjectOptions(sites), [sites]);
  const projectSelectOptions = useMemo(() => toProjectSelectOptions(projects), [projects]);
  const siteSelectOptions = useMemo(
    () => toScopeSiteSelectOptions(sites.filter((site) => !filters.projectId || site.project.id === filters.projectId)),
    [filters.projectId, sites],
  );
  const generalSupervisorSelectOptions = useMemo(
    () => toScopeUserSelectOptions(generalSupervisors),
    [generalSupervisors],
  );
  const filteredScopes = useMemo(() => filterScopes(scopes, filters), [filters, scopes]);
  const activeCount = scopes.filter((scope) => scope.status === GeneralSupervisorSiteScopeStatus.ACTIVE).length;
  const inactiveCount = scopes.filter((scope) => scope.status === GeneralSupervisorSiteScopeStatus.INACTIVE).length;
  const siteCount = new Set(scopes.map((scope) => scope.siteId)).size;

  function setFilter(key: keyof ScopeFilters, value: string) {
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === 'projectId' ? { siteId: '' } : {}),
    }));
  }

  function openCreate() {
    setForm(createEmptyForm());
    setDrawerMode('create');
  }

  function openEdit(scope: GeneralSupervisorScopeItem) {
    setForm({
      id: scope.id,
      generalSupervisorId: scope.generalSupervisorId,
      projectId: scope.site.project.id,
      siteId: scope.siteId,
      startDate: scope.startDate,
      endDate: scope.endDate ?? '',
      status: scope.status,
    });
    setDrawerMode('edit');
  }

  function closeDrawer() {
    setDrawerMode(null);
    setForm(createEmptyForm());
  }

  function submitForm() {
    if (drawerMode === 'create') {
      const payload: CreateGeneralSupervisorScopeRequest = {
        generalSupervisorId: form.generalSupervisorId,
        siteId: form.siteId,
        startDate: form.startDate,
        endDate: form.endDate || null,
      };
      createMutation.mutate(payload);
      return;
    }

    if (drawerMode === 'edit' && form.id) {
      updateMutation.mutate({
        id: form.id,
        data: {
          startDate: form.startDate,
          endDate: form.endDate || null,
          status: form.status,
        },
      });
    }
  }

  function pushError(title: string, error: unknown) {
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
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">Perimetres GS</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Sites confies aux superviseurs generaux</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Pilote les perimetres de supervision qui alimentent le planning et les vues operationnelles.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={scopesQuery.isFetching ? 'warning' : 'info'}>
              {scopesQuery.isFetching ? 'Actualisation...' : `${filteredScopes.length} ligne(s)`}
            </Badge>
            {!canMutate ? <Badge tone="neutral">Lecture seule</Badge> : null}
          </div>
        </div>
      </section>

      {data ? (
        <section className="grid gap-4 md:grid-cols-4">
          <MetricCard label="Total" value={scopes.length} />
          <MetricCard label="Actifs" value={activeCount} tone="success" />
          <MetricCard label="Inactifs" value={inactiveCount} tone="neutral" />
          <MetricCard label="Chantiers" value={siteCount} tone="info" />
        </section>
      ) : null}

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
        <div className="grid gap-4 lg:grid-cols-4">
          <Field label="Projet">
            <SearchableSelect
              onChange={(value) => setFilter('projectId', value)}
              options={projectSelectOptions}
              placeholder="Tous les projets"
              value={filters.projectId}
            />
          </Field>
          <Field label="Chantier">
            <SearchableSelect
              onChange={(value) => setFilter('siteId', value)}
              options={siteSelectOptions}
              placeholder="Tous les chantiers"
              value={filters.siteId}
            />
          </Field>
          <Field label="Superviseur general">
            <SearchableSelect
              onChange={(value) => setFilter('generalSupervisorId', value)}
              options={generalSupervisorSelectOptions}
              placeholder="Tous les superviseurs"
              value={filters.generalSupervisorId}
            />
          </Field>
          <Field label="Statut">
            <select
              className={inputClassName}
              onChange={(event) => setFilter('status', event.target.value)}
              value={filters.status}
            >
              <option value="ALL">Tous</option>
              <option value={GeneralSupervisorSiteScopeStatus.ACTIVE}>Actif</option>
              <option value={GeneralSupervisorSiteScopeStatus.INACTIVE}>Inactif</option>
            </select>
          </Field>
        </div>
        {canMutate ? (
          <div className="mt-5 flex justify-end">
            <button
              className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              onClick={openCreate}
              type="button"
            >
              Nouveau perimetre
            </button>
          </div>
        ) : null}
      </section>

      {scopesQuery.isLoading ? <LoadingState /> : null}
      {scopesQuery.isError ? (
        <EmptyState title="Perimetres indisponibles" description="Impossible de charger les perimetres GS pour le moment." />
      ) : null}

      {data ? (
        <ScopesTable
          canMutate={canMutate}
          isMutating={updateMutation.isPending || deactivateMutation.isPending}
          onDeactivate={setDeleteTarget}
          onEdit={openEdit}
          scopes={filteredScopes}
        />
      ) : null}

      {drawerMode ? (
        <ScopeDrawer
          form={form}
          generalSupervisors={generalSupervisors}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
          mode={drawerMode}
          onCancel={closeDrawer}
          onChange={setForm}
          onSubmit={submitForm}
          projects={projects}
          sites={sites}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDeactivateModal
          isDeleting={deactivateMutation.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deactivateMutation.mutate(deleteTarget.id)}
          scope={deleteTarget}
        />
      ) : null}
    </div>
  );
}

function ScopesTable({
  scopes,
  canMutate,
  isMutating,
  onEdit,
  onDeactivate,
}: Readonly<{
  scopes: GeneralSupervisorScopeItem[];
  canMutate: boolean;
  isMutating: boolean;
  onEdit: (scope: GeneralSupervisorScopeItem) => void;
  onDeactivate: (scope: GeneralSupervisorScopeItem) => void;
}>) {
  if (scopes.length === 0) {
    return <EmptyState title="Aucun perimetre" description="Aucun perimetre ne correspond aux filtres selectionnes." />;
  }

  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-panel">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="px-4 py-4">Superviseur general</th>
              <th className="px-4 py-4">Projet</th>
              <th className="px-4 py-4">Chantier</th>
              <th className="px-4 py-4">Chef de projet</th>
              <th className="px-4 py-4">Debut</th>
              <th className="px-4 py-4">Fin</th>
              <th className="px-4 py-4">Statut</th>
              {canMutate ? <th className="px-4 py-4">Actions</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {scopes.map((scope) => (
              <tr className="align-top" key={scope.id}>
                <td className="px-4 py-4">
                  <p className="font-semibold text-slate-950">
                    {scope.generalSupervisor.firstName} {scope.generalSupervisor.lastName}
                  </p>
                  <p className="text-xs text-slate-500">{scope.generalSupervisor.email}</p>
                </td>
                <td className="px-4 py-4 text-slate-700">{scope.site.project.name}</td>
                <td className="px-4 py-4">
                  <p className="font-semibold text-slate-800">{scope.site.name}</p>
                  <p className="text-xs text-slate-500">{scope.site.address}</p>
                </td>
                <td className="px-4 py-4">
                  <p className="font-semibold text-slate-800">
                    {scope.projectManager.firstName} {scope.projectManager.lastName}
                  </p>
                  <p className="text-xs text-slate-500">{scope.projectManager.email}</p>
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-slate-700">{formatDate(scope.startDate)}</td>
                <td className="whitespace-nowrap px-4 py-4 text-slate-700">{scope.endDate ? formatDate(scope.endDate) : 'Sans fin'}</td>
                <td className="px-4 py-4">
                  <Badge tone={scope.status === GeneralSupervisorSiteScopeStatus.ACTIVE ? 'success' : 'neutral'}>
                    {scope.status === GeneralSupervisorSiteScopeStatus.ACTIVE ? 'Actif' : 'Inactif'}
                  </Badge>
                </td>
                {canMutate ? (
                  <td className="px-4 py-4">
                    <TableActionsMenu
                      actions={[
                        {
                          label: 'Modifier',
                          icon: <Pencil className="h-4 w-4" />,
                          disabled: isMutating,
                          onClick: () => onEdit(scope),
                        },
                        ...(scope.status === GeneralSupervisorSiteScopeStatus.ACTIVE
                          ? [
                              {
                                label: 'Desactiver',
                                icon: <UserRoundX className="h-4 w-4" />,
                                tone: 'danger' as const,
                                disabled: isMutating,
                                onClick: () => onDeactivate(scope),
                              },
                            ]
                          : []),
                      ]}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ScopeDrawer({
  mode,
  form,
  projects,
  sites,
  generalSupervisors,
  isSubmitting,
  onChange,
  onCancel,
  onSubmit,
}: Readonly<{
  mode: 'create' | 'edit';
  form: ScopeFormState;
  projects: { id: string; name: string }[];
  sites: GeneralSupervisorScopeSiteOption[];
  generalSupervisors: GeneralSupervisorScopeUserOption[];
  isSubmitting: boolean;
  onChange: (form: ScopeFormState) => void;
  onCancel: () => void;
  onSubmit: () => void;
}>) {
  const generalSupervisorOptions = toScopeUserSelectOptions(generalSupervisors);
  const projectOptions = toProjectSelectOptions(projects);
  const siteOptions = toScopeSiteSelectOptions(sites.filter((site) => !form.projectId || site.project.id === form.projectId));
  const canSubmit =
    mode === 'create'
      ? Boolean(form.generalSupervisorId && form.siteId && form.startDate)
      : Boolean(form.startDate);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50">
      <aside className="fixed inset-y-0 right-0 flex w-full max-w-xl flex-col bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
        <div className="border-b border-slate-200 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
            {mode === 'create' ? 'Nouveau perimetre' : 'Modifier perimetre'}
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">Perimetre superviseur general</h2>
        </div>
        <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto p-6">
          <Field label="Superviseur general">
            <SearchableSelect
              disabled={mode === 'edit'}
              onChange={(value) => onChange({ ...form, generalSupervisorId: value })}
              options={generalSupervisorOptions}
              placeholder="Selectionner un superviseur"
              value={form.generalSupervisorId}
            />
          </Field>
          <Field label="Projet">
            <SearchableSelect
              disabled={mode === 'edit'}
              onChange={(value) => onChange({ ...form, projectId: value, siteId: '' })}
              options={projectOptions}
              placeholder="Tous les projets"
              value={form.projectId}
            />
          </Field>
          <Field label="Chantier">
            <SearchableSelect
              disabled={mode === 'edit'}
              onChange={(value) => onChange({ ...form, siteId: value })}
              options={siteOptions}
              placeholder="Selectionner un chantier"
              value={form.siteId}
            />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Date debut">
              <input
                className={inputClassName}
                onChange={(event) => onChange({ ...form, startDate: event.target.value })}
                type="date"
                value={form.startDate}
              />
            </Field>
            <Field label="Date fin">
              <input
                className={inputClassName}
                onChange={(event) => onChange({ ...form, endDate: event.target.value })}
                type="date"
                value={form.endDate}
              />
            </Field>
          </div>
          {mode === 'edit' ? (
            <Field label="Statut">
              <select
                className={inputClassName}
                onChange={(event) => onChange({ ...form, status: event.target.value as GeneralSupervisorSiteScopeStatus })}
                value={form.status}
              >
                <option value={GeneralSupervisorSiteScopeStatus.ACTIVE}>Actif</option>
                <option value={GeneralSupervisorSiteScopeStatus.INACTIVE}>Inactif</option>
              </select>
            </Field>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-200 p-6">
          <button className={secondaryButtonClassName} onClick={onCancel} type="button">
            Annuler
          </button>
          <button
            className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
            disabled={!canSubmit || isSubmitting}
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

function ConfirmDeactivateModal({
  scope,
  isDeleting,
  onCancel,
  onConfirm,
}: Readonly<{
  scope: GeneralSupervisorScopeItem;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <section className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-panel">
        <h2 className="text-xl font-semibold text-slate-950">Desactiver ce perimetre ?</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {scope.generalSupervisor.firstName} {scope.generalSupervisor.lastName} ne verra plus {scope.site.name} dans son perimetre actif.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button className={secondaryButtonClassName} onClick={onCancel} type="button">
            Annuler
          </button>
          <button
            className="rounded-2xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
            disabled={isDeleting}
            onClick={onConfirm}
            type="button"
          >
            {isDeleting ? 'Desactivation...' : 'Desactiver'}
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

function MetricCard({
  label,
  value,
  tone = 'neutral',
}: Readonly<{ label: string; value: number; tone?: 'success' | 'neutral' | 'info' }>) {
  const className = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    neutral: 'border-slate-200 bg-white text-slate-900',
    info: 'border-blue-200 bg-blue-50 text-blue-900',
  }[tone];

  return (
    <article className={`rounded-[2rem] border p-5 shadow-panel ${className}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70">{label}</p>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
    </article>
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

async function fetchScopes() {
  const response = await authFetch('/api/general-supervisor-scopes', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de charger les perimetres.'));
  }
  return (await response.json()) as GeneralSupervisorScopesResponse;
}

async function createScope(data: CreateGeneralSupervisorScopeRequest) {
  const response = await authFetch('/api/general-supervisor-scopes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de creer le perimetre.'));
  }
  return (await response.json()) as { scope: GeneralSupervisorScopeItem };
}

async function updateScope(id: string, data: UpdateGeneralSupervisorScopeRequest) {
  const response = await authFetch(`/api/general-supervisor-scopes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de modifier le perimetre.'));
  }
  return (await response.json()) as { scope: GeneralSupervisorScopeItem };
}

async function deactivateScope(id: string) {
  const response = await authFetch(`/api/general-supervisor-scopes/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de desactiver le perimetre.'));
  }
}

async function getApiErrorMessage(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { message?: string; code?: string };
    return payload.message ?? payload.code ?? fallback;
  } catch {
    return fallback;
  }
}

function filterScopes(scopes: GeneralSupervisorScopeItem[], filters: ScopeFilters) {
  return scopes.filter(
    (scope) =>
      (!filters.projectId || scope.site.project.id === filters.projectId) &&
      (!filters.siteId || scope.siteId === filters.siteId) &&
      (!filters.generalSupervisorId || scope.generalSupervisorId === filters.generalSupervisorId) &&
      (filters.status === 'ALL' || scope.status === filters.status),
  );
}

function getProjectOptions(sites: GeneralSupervisorScopeSiteOption[]) {
  const projects = new Map<string, string>();
  sites.forEach((site) => projects.set(site.project.id, site.project.name));
  return [...projects.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function toProjectSelectOptions(projects: { id: string; name: string }[]): SearchableSelectOption[] {
  return projects.map((project) => ({
    value: project.id,
    label: project.name,
  }));
}

function toScopeSiteSelectOptions(sites: GeneralSupervisorScopeSiteOption[]): SearchableSelectOption[] {
  return sites.map((site) => ({
    value: site.id,
    label: site.name,
    description: site.project.name,
    keywords: site.address,
  }));
}

function toScopeUserSelectOptions(users: GeneralSupervisorScopeUserOption[]): SearchableSelectOption[] {
  return users.map((user) => ({
    value: user.id,
    label: `${user.firstName} ${user.lastName}`,
    ...(user.email ? { description: user.email } : {}),
  }));
}

function createEmptyForm(): ScopeFormState {
  return {
    generalSupervisorId: '',
    projectId: '',
    siteId: '',
    startDate: todayKey,
    endDate: '',
    status: GeneralSupervisorSiteScopeStatus.ACTIVE,
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00.000Z`));
}
