'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Role } from '@prisma/client';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { SearchableSelect } from '@/components/searchable-select';
import { authFetch } from '@/lib/auth/client-session';
import { formatRoleLabel } from '@/lib/role-labels';
import type { RhResourceListItem, RhResourcesResponse } from '@/types/rh';

const inputClassName =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white';

export function RhResourcesPage() {
  const queryClient = useQueryClient();
  const [role, setRole] = useState('');
  const [presenceStatus, setPresenceStatus] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [editingResource, setEditingResource] = useState<RhResourceListItem | null>(null);
  const [editForm, setEditForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    matricule: '',
    contact: '',
  });
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(timeoutId);
  }, [search]);

  const requestPath = useMemo(() => {
    const searchParams = new URLSearchParams();
    if (role) searchParams.set('role', role);
    if (presenceStatus) searchParams.set('presenceStatus', presenceStatus);
    if (debouncedSearch) searchParams.set('q', debouncedSearch);
    const query = searchParams.toString();
    return query ? `/api/rh/resources?${query}` : '/api/rh/resources';
  }, [debouncedSearch, presenceStatus, role]);

  const resourcesQuery = useQuery({
    queryKey: ['rh-resources', requestPath],
    queryFn: async () => {
      const response = await authFetch(requestPath, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`RH resources failed with status ${response.status}`);
      }

      return (await response.json()) as RhResourcesResponse;
    },
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
  });

  const data = resourcesQuery.data;
  const roleOptions = useMemo(
    () => (data?.roles ?? []).map((item) => ({ value: item, label: formatRoleLabel(item as Role) })),
    [data?.roles],
  );
  const updateResourceMutation = useMutation({
    mutationFn: async () => {
      if (!editingResource) {
        return null;
      }

      const response = await authFetch(`/api/rh/resources/${editingResource.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? 'Modification impossible.');
      }

      return (await response.json()) as { resource: RhResourceListItem };
    },
    onSuccess: async () => {
      setEditingResource(null);
      setEditError(null);
      await queryClient.invalidateQueries({ queryKey: ['rh-resources'] });
    },
    onError: (error) => {
      setEditError(error instanceof Error ? error.message : 'Modification impossible.');
    },
  });

  function openEditResource(resource: RhResourceListItem) {
    setEditingResource(resource);
    setEditForm({
      firstName: resource.firstName,
      lastName: resource.lastName,
      email: resource.email ?? '',
      matricule: resource.matricule ?? '',
      contact: resource.contact ?? '',
    });
    setEditError(null);
  }

  function submitEditResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEditError(null);
    updateResourceMutation.mutate();
  }

  if (resourcesQuery.isLoading && !data) {
    return (
      <p className="rounded-[2rem] border border-slate-200 bg-white p-6 text-sm font-semibold text-slate-500 shadow-panel">
        Chargement des ressources...
      </p>
    );
  }

  if (resourcesQuery.isError) {
    return <EmptyState title="Ressources indisponibles" description="La liste RH des ressources ne peut pas etre chargee." />;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">RH</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Ressources</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
          Liste des ressources actives avec leur identifiant, role, email, matricule et presence du jour.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <KpiCard label="Ressources actives" value={data?.totalItems ?? 0} />
        <KpiCard label="Matricules manquants" tone="warning" value={data?.missingMatricule ?? 0} />
        <KpiCard label="Roles affiches" value={data?.roles.length ?? 0} />
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Recherche</span>
            <input
              className={inputClassName}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nom, username, email ou matricule"
              type="search"
              value={search}
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Role</span>
            <SearchableSelect onChange={setRole} options={roleOptions} placeholder="Tous les roles" value={role} />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Presence du jour</span>
            <select className={inputClassName} onChange={(event) => setPresenceStatus(event.target.value)} value={presenceStatus}>
              <option value="">Tous</option>
              <option value="present-terrain">Presents terrain</option>
              <option value="present-office">Presents bureau</option>
              <option value="absent">Absents</option>
              <option value="late">Retards</option>
              <option value="none">Sans pointage</option>
            </select>
          </label>
        </div>
        {resourcesQuery.isFetching ? (
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Recherche en cours...</p>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-panel">
        {(data?.items.length ?? 0) === 0 ? (
          <EmptyState title="Aucune ressource" description="Aucune ressource active ne correspond aux filtres." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                <tr>
                  <th className="px-5 py-4">Modifier</th>
                  <th className="px-5 py-4">Matricule</th>
                  <th className="px-5 py-4">Nom</th>
                  <th className="px-5 py-4">Type</th>
                  <th className="px-5 py-4">Role</th>
                  <th className="px-5 py-4">Identifiant</th>
                  <th className="px-5 py-4">Email</th>
                  <th className="px-5 py-4">Presence du jour</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.items ?? []).map((resource) => (
                  <tr key={resource.id} className="align-top">
                    <td className="px-5 py-4">
                      <button
                        className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-700 transition hover:border-orange-300 hover:text-orange-700"
                        onClick={() => openEditResource(resource)}
                        type="button"
                      >
                        Modifier
                      </button>
                    </td>
                    <td className="px-5 py-4">
                      {resource.matricule ? (
                        <span className="font-semibold text-slate-800">{resource.matricule}</span>
                      ) : (
                        <Badge tone="warning">A renseigner</Badge>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-black text-slate-950">{resource.firstName} {resource.lastName}</p>
                    </td>
                    <td className="px-5 py-4">
                      <Badge tone={resource.resourceType === 'EXTERNAL' ? 'warning' : 'success'}>
                        {resource.resourceType === 'EXTERNAL' ? 'Externe' : 'Interne'}
                      </Badge>
                    </td>
                    <td className="px-5 py-4">
                      <Badge tone="neutral">{formatRoleLabel(resource.role as Role)}</Badge>
                    </td>
                    <td className="px-5 py-4 font-semibold text-slate-700">{resource.username}</td>
                    <td className="px-5 py-4 text-slate-600">{resource.email ?? '-'}</td>
                    <td className="px-5 py-4">
                      <PresenceBadge presence={resource.todayPresence} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {editingResource ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 sm:items-center">
          <form
            className="w-full max-w-2xl rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl"
            onSubmit={submitEditResource}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-600">Ressource RH</p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-950">Modifier les informations</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Le role, le statut et le mot de passe restent geres dans l&apos;administration utilisateurs.
                </p>
              </div>
              <button
                className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-black text-slate-600"
                onClick={() => setEditingResource(null)}
                type="button"
              >
                Fermer
              </button>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <TextField label="Prenom" value={editForm.firstName} onChange={(value) => setEditForm((form) => ({ ...form, firstName: value }))} required />
              <TextField label="Nom" value={editForm.lastName} onChange={(value) => setEditForm((form) => ({ ...form, lastName: value }))} required />
              <TextField label="Email" type="email" value={editForm.email} onChange={(value) => setEditForm((form) => ({ ...form, email: value }))} />
              <TextField label="Matricule" value={editForm.matricule} onChange={(value) => setEditForm((form) => ({ ...form, matricule: value }))} />
              <TextField label="Contact" value={editForm.contact} onChange={(value) => setEditForm((form) => ({ ...form, contact: value }))} />
            </div>

            {editError ? (
              <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">{editError}</p>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                className="rounded-full border border-slate-200 px-5 py-2 text-sm font-black text-slate-600"
                onClick={() => setEditingResource(null)}
                type="button"
              >
                Annuler
              </button>
              <button
                className="rounded-full bg-slate-950 px-5 py-2 text-sm font-black text-white disabled:opacity-60"
                disabled={updateResourceMutation.isPending}
                type="submit"
              >
                {updateResourceMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function TextField({
  label,
  onChange,
  required = false,
  type = 'text',
  value,
}: Readonly<{
  label: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
  value: string;
}>) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <input
        className={inputClassName}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        type={type}
        value={value}
      />
    </label>
  );
}

function PresenceBadge({
  presence,
}: Readonly<{
  presence: RhResourcesResponse['items'][number]['todayPresence'];
}>) {
  let tone: 'neutral' | 'success' | 'warning' | 'error' = 'neutral';
  if (presence.status === 'PRESENT') tone = 'success';
  if (presence.status === 'PAUSED' || presence.isLate) tone = 'warning';
  if (presence.status === 'ABSENT' || presence.status === 'ANOMALY') tone = 'error';

  return (
    <div className="space-y-1">
      <Badge tone={tone}>{presence.label}</Badge>
      {presence.isLate ? <p className="text-xs font-bold text-orange-700">Retard</p> : null}
      {presence.arrivalAt ? <p className="text-xs text-slate-500">Entree {formatTime(presence.arrivalAt)}</p> : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone = 'neutral',
}: Readonly<{
  label: string;
  value: number;
  tone?: 'neutral' | 'warning';
}>) {
  const className = tone === 'warning' ? 'border-orange-200 bg-orange-50 text-orange-950' : 'border-slate-200 bg-white text-slate-950';

  return (
    <article className={`rounded-[2rem] border p-5 shadow-panel ${className}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-70">{label}</p>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
    </article>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
