'use client';

import { GeneralSupervisorSiteScopeStatus } from '@prisma/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authFetch } from '@/lib/auth/client-session';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type {
  CreateGeneralSupervisorScopeRequest,
  GeneralSupervisorScopeItem,
  GeneralSupervisorScopesResponse,
} from '@/types/general-supervisor-scopes';

type MobileGeneralSupervisorScopesPageProps = Readonly<{
  user: WebSessionUser;
}>;

const todayKey = new Date().toISOString().slice(0, 10);

export function MobileGeneralSupervisorScopesPage({ user }: MobileGeneralSupervisorScopesPageProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<CreateGeneralSupervisorScopeRequest>({
    generalSupervisorId: '',
    scopeType: 'SITES',
    siteId: '',
    startDate: todayKey,
    endDate: null,
  });

  const scopesQuery = useQuery({
    queryKey: ['mobile-general-supervisor-scopes'],
    queryFn: async () => {
      const response = await authFetch('/api/mobile/general-supervisor-scopes');
      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Impossible de charger les périmètres.'));
      }

      return (await response.json()) as GeneralSupervisorScopesResponse;
    },
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: async (data: CreateGeneralSupervisorScopeRequest) => {
      const response = await authFetch('/api/mobile/general-supervisor-scopes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Impossible de confier ce chantier.'));
      }

      return (await response.json()) as { scope: GeneralSupervisorScopeItem };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mobile-general-supervisor-scopes'] });
      setFormData({ generalSupervisorId: '', scopeType: 'SITES', siteId: '', startDate: todayKey, endDate: null });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async (scopeId: string) => {
      const response = await authFetch(`/api/mobile/general-supervisor-scopes/${encodeURIComponent(scopeId)}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Impossible de désactiver ce périmètre.'));
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mobile-general-supervisor-scopes'] });
    },
  });

  const data = scopesQuery.data;
  const canSubmit = Boolean(formData.generalSupervisorId && formData.siteId && formData.startDate);
  const mutationError = getErrorMessage(createMutation.error) ?? getErrorMessage(deactivateMutation.error);
  const activeScopes = data?.scopes.filter((scope) => scope.status === GeneralSupervisorSiteScopeStatus.ACTIVE) ?? [];
  const inactiveScopes = data?.scopes.filter((scope) => scope.status === GeneralSupervisorSiteScopeStatus.INACTIVE) ?? [];

  function submitScope() {
    if (!canSubmit) return;
    createMutation.mutate(formData);
  }

  return (
    <div className="space-y-5 pb-20">
      <section className="rounded-lg border border-primary/20 bg-primary/10 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Périmètres supervision</p>
        <h1 className="mt-1 text-2xl font-black leading-7 text-slate-950">
          Sites confiés aux superviseurs généraux
        </h1>
        <p className="mt-2 text-sm font-semibold text-slate-600">
          {user.role === 'PROJECT_MANAGER'
            ? 'Confiez les chantiers de vos projets aux superviseurs généraux.'
            : 'Gestion globale des périmètres de supervision.'}
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
        <h2 className="text-base font-black text-slate-950">Nouveau périmètre</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-sm font-bold text-slate-700">
            Superviseur général
            <select
              className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none focus:border-primary"
              onChange={(event) => setFormData((current) => ({ ...current, generalSupervisorId: event.target.value }))}
              value={formData.generalSupervisorId}
            >
              <option value="">Sélectionner</option>
              {data?.generalSupervisors.map((supervisor) => (
                <option key={supervisor.id} value={supervisor.id}>
                  {supervisor.firstName} {supervisor.lastName}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-bold text-slate-700">
            Chantier confié
            <select
              className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none focus:border-primary"
              onChange={(event) => setFormData((current) => ({ ...current, siteId: event.target.value }))}
              value={formData.siteId}
            >
              <option value="">Sélectionner</option>
              {data?.sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.project.name} - {site.name}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-bold text-slate-700">
              Début
              <input
                className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none focus:border-primary"
                onChange={(event) => setFormData((current) => ({ ...current, startDate: event.target.value }))}
                type="date"
                value={formData.startDate}
              />
            </label>
            <label className="block text-sm font-bold text-slate-700">
              Fin
              <input
                className="mt-2 min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none focus:border-primary"
                onChange={(event) => setFormData((current) => ({ ...current, endDate: event.target.value || null }))}
                type="date"
                value={formData.endDate ?? ''}
              />
            </label>
          </div>

          <button
            className="min-h-12 w-full rounded-lg bg-slate-950 px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canSubmit || createMutation.isPending}
            onClick={submitScope}
            type="button"
          >
            {createMutation.isPending ? 'Enregistrement...' : 'Confier le chantier'}
          </button>
        </div>
      </section>

      {scopesQuery.isLoading ? <LoadingBlock /> : null}
      {scopesQuery.isError ? <ErrorBlock message={getErrorMessage(scopesQuery.error) ?? 'Impossible de charger les périmètres.'} /> : null}
      {mutationError ? <ErrorBlock message={mutationError} /> : null}

      {data?.generalSupervisors.length === 0 ? (
        <EmptyBlock title="Aucun superviseur général actif" description="Créez ou activez un superviseur général avant de confier un chantier." />
      ) : null}

      {data?.sites.length === 0 ? (
        <EmptyBlock title="Aucun chantier actif" description="Aucun chantier actif n'est disponible dans votre périmètre." />
      ) : null}

      <ScopeList
        isMutating={deactivateMutation.isPending}
        onDeactivate={(scopeId) => deactivateMutation.mutate(scopeId)}
        scopes={activeScopes}
        title="Périmètres actifs"
      />

      {inactiveScopes.length > 0 ? (
        <ScopeList
          isMutating={deactivateMutation.isPending}
          onDeactivate={(scopeId) => deactivateMutation.mutate(scopeId)}
          scopes={inactiveScopes}
          title="Historique"
        />
      ) : null}
    </div>
  );
}

function ScopeList({
  title,
  scopes,
  isMutating,
  onDeactivate,
}: Readonly<{
  title: string;
  scopes: GeneralSupervisorScopeItem[];
  isMutating: boolean;
  onDeactivate: (scopeId: string) => void;
}>) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">{title}</h2>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-black text-slate-500">{scopes.length}</span>
      </div>

      {scopes.length === 0 ? (
        <EmptyBlock title="Aucun périmètre" description="Aucun chantier n'est confié pour le moment." />
      ) : (
        scopes.map((scope) => (
          <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel" key={scope.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-black text-slate-950">
                  {scope.generalSupervisor.firstName} {scope.generalSupervisor.lastName}
                </p>
                <p className="mt-1 text-sm font-bold text-slate-500">
                  {scope.scopeType === 'PROJECT'
                    ? `${scope.project.name} - Tout le projet`
                    : `${scope.project.name} - ${scope.site.name}`}
                </p>
              </div>
              <span className={`rounded-full px-2 py-1 text-[11px] font-black ${scope.status === GeneralSupervisorSiteScopeStatus.ACTIVE ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {scope.status === GeneralSupervisorSiteScopeStatus.ACTIVE ? 'Actif' : 'Inactif'}
              </span>
            </div>
            <p className="mt-3 text-xs font-bold uppercase tracking-[0.1em] text-slate-400">
              Du {formatDate(scope.startDate)} {scope.endDate ? `au ${formatDate(scope.endDate)}` : '- sans date de fin'}
            </p>
            {scope.status === GeneralSupervisorSiteScopeStatus.ACTIVE ? (
              <button
                className="mt-4 min-h-11 w-full rounded-lg border border-red-200 bg-red-50 text-xs font-black text-red-700 disabled:opacity-60"
                disabled={isMutating}
                onClick={() => onDeactivate(scope.id)}
                type="button"
              >
                Désactiver
              </button>
            ) : null}
          </article>
        ))
      )}
    </section>
  );
}

function LoadingBlock() {
  return <section className="rounded-lg border border-slate-200 bg-white p-4 text-sm font-bold text-slate-500">Chargement...</section>;
}

function ErrorBlock({ message }: Readonly<{ message: string }>) {
  return <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{message}</section>;
}

function EmptyBlock({ title, description }: Readonly<{ title: string; description: string }>) {
  return (
    <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
      <h3 className="text-base font-black text-slate-950">{title}</h3>
      <p className="mt-2 text-sm font-semibold text-slate-500">{description}</p>
    </section>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : null;
}

async function getApiErrorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { message?: unknown; code?: unknown };
    if (typeof body.message === 'string') return body.message;
    if (typeof body.code === 'string') return body.code;
  } catch {
    return fallback;
  }

  return fallback;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}
