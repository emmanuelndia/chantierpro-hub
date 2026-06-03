'use client';

import type { Role } from '@prisma/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { TableActionsMenu } from '@/components/table-actions-menu';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import type {
  CoordinatorProjectManagerScopeItem,
  CoordinatorProjectManagerScopesResponse,
  CreateCoordinatorProjectManagerScopeRequest,
} from '@/types/coordinator-project-manager-scopes';

type CoordinatorProjectManagerScopesPageProps = Readonly<{
  viewer: {
    role: Role;
  };
}>;

type FormState = {
  coordinatorId: string;
  projectManagerId: string;
};

const inputClassName =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-500';

export function CoordinatorProjectManagerScopesPage({ viewer }: CoordinatorProjectManagerScopesPageProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const canSelectProjectManager = viewer.role === 'ADMIN';
  const [form, setForm] = useState<FormState>({ coordinatorId: '', projectManagerId: '' });
  const [projectManagerSearch, setProjectManagerSearch] = useState('');
  const [coordinatorSearch, setCoordinatorSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<CoordinatorProjectManagerScopeItem | null>(null);

  const scopesQuery = useQuery({
    queryKey: ['coordinator-project-manager-scopes'],
    queryFn: fetchScopes,
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: createScope,
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Coordinateur rattache' });
      setForm({ coordinatorId: '', projectManagerId: '' });
      await queryClient.invalidateQueries({ queryKey: ['coordinator-project-manager-scopes'] });
      await queryClient.invalidateQueries({ queryKey: ['web-reports'] });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Rattachement impossible',
        message: error instanceof Error ? error.message : 'Operation refusee.',
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteScope,
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Rattachement retire' });
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['coordinator-project-manager-scopes'] });
      await queryClient.invalidateQueries({ queryKey: ['web-reports'] });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Retrait impossible',
        message: error instanceof Error ? error.message : 'Operation refusee.',
      });
    },
  });

  const data = scopesQuery.data;
  const projectManagerOptions = useMemo(
    () => filterCoordinatorUsers(data?.projectManagers ?? [], projectManagerSearch),
    [data?.projectManagers, projectManagerSearch],
  );
  const activeProjectManagerId = canSelectProjectManager ? form.projectManagerId : data?.projectManagers[0]?.id ?? '';
  const coordinatorOptions = useMemo(() => {
    const existingForProject = new Set(
      data?.scopes
        .filter((scope) => scope.projectManagerId === activeProjectManagerId)
        .map((scope) => scope.coordinatorId) ?? [],
    );
    return filterCoordinatorUsers(
      data?.coordinators.filter((coordinator) => !existingForProject.has(coordinator.id)) ?? [],
      coordinatorSearch,
    );
  }, [activeProjectManagerId, coordinatorSearch, data?.coordinators, data?.scopes]);

  const canSubmit = Boolean(form.coordinatorId && (!canSelectProjectManager || form.projectManagerId));

  function submitForm() {
    const payload: CreateCoordinatorProjectManagerScopeRequest = {
      coordinatorId: form.coordinatorId,
      ...(canSelectProjectManager ? { projectManagerId: form.projectManagerId } : {}),
    };
    createMutation.mutate(payload);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">Coordinateurs projet</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Rattachement des coordinateurs</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Choisis les coordinateurs qui suivent les rapports de ton portefeuille. Un coordinateur peut suivre plusieurs chefs projets.
            </p>
          </div>
          <Badge tone={scopesQuery.isFetching ? 'warning' : 'info'}>
            {scopesQuery.isFetching ? 'Actualisation...' : `${data?.scopes.length ?? 0} rattachement(s)`}
          </Badge>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Coordinateurs rattaches" value={new Set(data?.scopes.map((scope) => scope.coordinatorId)).size} />
        <MetricCard label="Chefs projets suivis" value={new Set(data?.scopes.map((scope) => scope.projectManagerId)).size} />
        <MetricCard label="Rattachements" value={data?.scopes.length ?? 0} />
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
        <div className={`grid gap-4 ${canSelectProjectManager ? 'lg:grid-cols-[1fr_1fr_auto]' : 'lg:grid-cols-[1fr_auto]'}`}>
          {canSelectProjectManager ? (
            <Field label="Chef projet">
              <input
                className={`${inputClassName} mb-2`}
                onChange={(event) => setProjectManagerSearch(event.target.value)}
                placeholder="Rechercher un chef projet..."
                type="search"
                value={projectManagerSearch}
              />
              <select
                className={inputClassName}
                onChange={(event) => setForm((current) => ({ ...current, projectManagerId: event.target.value, coordinatorId: '' }))}
                value={form.projectManagerId}
              >
                <option value="">Selectionner</option>
                {projectManagerOptions.map((projectManager) => (
                  <option key={projectManager.id} value={projectManager.id}>
                    {projectManager.firstName} {projectManager.lastName}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Coordinateur">
            <input
              className={`${inputClassName} mb-2`}
              disabled={canSelectProjectManager && !form.projectManagerId}
              onChange={(event) => setCoordinatorSearch(event.target.value)}
              placeholder="Rechercher un coordinateur..."
              type="search"
              value={coordinatorSearch}
            />
            <select
              className={inputClassName}
              disabled={canSelectProjectManager && !form.projectManagerId}
              onChange={(event) => setForm((current) => ({ ...current, coordinatorId: event.target.value }))}
              value={form.coordinatorId}
            >
              <option value="">Selectionner</option>
              {coordinatorOptions.map((coordinator) => (
                <option key={coordinator.id} value={coordinator.id}>
                  {coordinator.firstName} {coordinator.lastName}
                </option>
              ))}
            </select>
          </Field>
          <div className="flex items-end">
            <button
              className="w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canSubmit || createMutation.isPending}
              onClick={submitForm}
              type="button"
            >
              {createMutation.isPending ? 'Ajout...' : 'Rattacher'}
            </button>
          </div>
        </div>
      </section>

      {scopesQuery.isLoading ? <LoadingState /> : null}
      {scopesQuery.isError ? (
        <EmptyState title="Coordinateurs indisponibles" description="Impossible de charger les rattachements coordinateurs." />
      ) : null}
      {data ? (
        <ScopesTable
          isMutating={deleteMutation.isPending}
          onDelete={setDeleteTarget}
          scopes={data.scopes}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDeleteModal
          isDeleting={deleteMutation.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          scope={deleteTarget}
        />
      ) : null}
    </div>
  );
}

function ScopesTable({
  scopes,
  isMutating,
  onDelete,
}: Readonly<{
  scopes: CoordinatorProjectManagerScopeItem[];
  isMutating: boolean;
  onDelete: (scope: CoordinatorProjectManagerScopeItem) => void;
}>) {
  if (scopes.length === 0) {
    return (
      <EmptyState
        title="Aucun coordinateur rattache"
        description="Ajoute un coordinateur pour lui donner la visibilite sur les rapports du portefeuille."
      />
    );
  }

  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-panel">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="px-4 py-4">Coordinateur</th>
              <th className="px-4 py-4">Chef projet</th>
              <th className="px-4 py-4">Date rattachement</th>
              <th className="px-4 py-4">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {scopes.map((scope) => (
              <tr className="align-top" key={scope.id}>
                <td className="px-4 py-4">
                  <p className="font-semibold text-slate-950">
                    {scope.coordinator.firstName} {scope.coordinator.lastName}
                  </p>
                  <p className="text-xs text-slate-500">{scope.coordinator.username}</p>
                </td>
                <td className="px-4 py-4">
                  <p className="font-semibold text-slate-800">
                    {scope.projectManager.firstName} {scope.projectManager.lastName}
                  </p>
                  <p className="text-xs text-slate-500">{scope.projectManager.username}</p>
                </td>
                <td className="px-4 py-4 text-slate-600">{formatDate(scope.createdAt)}</td>
                <td className="px-4 py-4">
                  <TableActionsMenu
                    actions={[
                      {
                        label: 'Retirer',
                        icon: <Trash2 className="h-4 w-4" />,
                        tone: 'danger',
                        disabled: isMutating,
                        onClick: () => onDelete(scope),
                      },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ConfirmDeleteModal({
  scope,
  isDeleting,
  onCancel,
  onConfirm,
}: Readonly<{
  scope: CoordinatorProjectManagerScopeItem;
  isDeleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <section className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-panel">
        <h2 className="text-xl font-semibold text-slate-950">Retirer ce coordinateur ?</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {scope.coordinator.firstName} {scope.coordinator.lastName} ne verra plus les rapports du portefeuille de{' '}
          {scope.projectManager.firstName} {scope.projectManager.lastName}.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" onClick={onCancel} type="button">
            Annuler
          </button>
          <button
            className="rounded-2xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-60"
            disabled={isDeleting}
            onClick={onConfirm}
            type="button"
          >
            {isDeleting ? 'Retrait...' : 'Retirer'}
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

function MetricCard({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <article className="rounded-[2rem] border border-slate-200 bg-white p-5 text-slate-900 shadow-panel">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
    </article>
  );
}

function LoadingState() {
  return <div className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />;
}

async function fetchScopes() {
  const response = await authFetch('/api/coordinator-project-manager-scopes', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de charger les coordinateurs projet.'));
  }
  return (await response.json()) as CoordinatorProjectManagerScopesResponse;
}

async function createScope(data: CreateCoordinatorProjectManagerScopeRequest) {
  const response = await authFetch('/api/coordinator-project-manager-scopes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de rattacher le coordinateur.'));
  }
  return (await response.json()) as { scope: CoordinatorProjectManagerScopeItem };
}

async function deleteScope(id: string) {
  const response = await authFetch(`/api/coordinator-project-manager-scopes/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(await getApiErrorMessage(response, 'Impossible de retirer le coordinateur.'));
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

function filterCoordinatorUsers<T extends { id: string; firstName: string; lastName: string; username: string; email: string | null }>(
  users: T[],
  search: string,
) {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) return users;

  return users.filter((user) =>
    `${user.firstName} ${user.lastName} ${user.username} ${user.email ?? ''}`.toLowerCase().includes(normalizedSearch),
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
