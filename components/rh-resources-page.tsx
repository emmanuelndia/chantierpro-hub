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
        <div className="border-b border-slate-100 px-5 py-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-600">Liste RH</p>
              <h2 className="mt-1 text-xl font-semibold text-slate-950">Ressources affichees</h2>
            </div>
            <p className="text-sm font-semibold text-slate-500">{data?.items.length ?? 0} ressource(s)</p>
          </div>
        </div>
        {(data?.items.length ?? 0) === 0 ? (
          <EmptyState title="Aucune ressource" description="Aucune ressource active ne correspond aux filtres." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                <tr>
                  <th className="px-5 py-4">Ressource</th>
                  <th className="px-5 py-4">Profil</th>
                  <th className="px-5 py-4">Coordonnees</th>
                  <th className="px-5 py-4">Presence du jour</th>
                  <th className="px-5 py-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(data?.items ?? []).map((resource) => (
                  <tr key={resource.id} className="align-middle transition hover:bg-slate-50/70">
                    <td className="px-5 py-4">
                      <div className="flex min-w-[260px] items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-sm font-black text-white">
                          {getResourceInitials(resource)}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-black text-slate-950">{resource.firstName} {resource.lastName}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            {resource.matricule ? (
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-600">
                                Mat. {resource.matricule}
                              </span>
                            ) : (
                              <Badge tone="warning">Matricule manquant</Badge>
                            )}
                            <span className="text-xs font-semibold text-slate-400">@{resource.username}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="space-y-2">
                        <Badge tone="neutral">{formatRoleLabel(resource.role as Role)}</Badge>
                        <div>
                          <Badge tone={resource.resourceType === 'EXTERNAL' ? 'warning' : 'success'}>
                            {resource.resourceType === 'EXTERNAL' ? 'Externe' : 'Interne'}
                          </Badge>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="min-w-[220px] space-y-1 text-sm text-slate-600">
                        <p className="font-semibold text-slate-800">{resource.email ?? 'Email non renseigne'}</p>
                        <p className="text-xs font-semibold text-slate-500">Contact : {resource.contact ?? '-'}</p>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <PresenceBadge presence={resource.todayPresence} />
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        aria-label={`Modifier ${resource.firstName} ${resource.lastName}`}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700"
                        onClick={() => openEditResource(resource)}
                        title="Modifier"
                        type="button"
                      >
                        <EditIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>      {editingResource ? (
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
  const presentation = getPresencePresentation(presence);
  const details = [
    presence.arrivalAt ? `Entree ${formatTime(presence.arrivalAt)}` : null,
    presence.departureAt ? `Sortie ${formatTime(presence.departureAt)}` : null,
    presence.isLate ? 'Retard' : null,
  ].filter(Boolean);

  return (
    <div className="min-w-[190px] space-y-2">
      <Badge className="tracking-[0.12em]" tone={presentation.tone}>{presentation.label}</Badge>
      <p className={`text-xs font-semibold ${presentation.helpClassName}`}>
        {details.length > 0 ? details.join(' - ') : presentation.helpText}
      </p>
    </div>
  );
}

function getPresencePresentation(presence: RhResourcesResponse['items'][number]['todayPresence']) {
  if (presence.status === 'PRESENT') {
    return {
      label: presence.context === 'OFFICE' ? 'Present bureau' : 'Present terrain',
      tone: 'success' as const,
      helpText: 'Session ouverte aujourd hui.',
      helpClassName: 'text-emerald-700',
    };
  }
  if (presence.status === 'PAUSED') {
    return {
      label: presence.context === 'OFFICE' ? 'Pause bureau' : 'Pause terrain',
      tone: 'warning' as const,
      helpText: 'Pause en cours.',
      helpClassName: 'text-orange-700',
    };
  }
  if (presence.status === 'LEFT') {
    return {
      label: presence.context === 'OFFICE' ? 'Sorti bureau' : 'Sorti terrain',
      tone: 'neutral' as const,
      helpText: 'Session fermee.',
      helpClassName: 'text-slate-500',
    };
  }
  if (presence.status === 'ABSENT') {
    return {
      label: 'Attendu non pointe',
      tone: 'error' as const,
      helpText: 'Planifie aujourd hui, aucune entree enregistree.',
      helpClassName: 'text-red-700',
    };
  }
  if (presence.status === 'ANOMALY') {
    return {
      label: 'A verifier',
      tone: 'error' as const,
      helpText: 'Pointage anomalie ou session fermee automatiquement.',
      helpClassName: 'text-red-700',
    };
  }

  return {
    label: 'Non pointe',
    tone: 'neutral' as const,
    helpText: 'Aucune entree enregistree aujourd hui.',
    helpClassName: 'text-slate-500',
  };
}

function getResourceInitials(resource: Pick<RhResourceListItem, 'firstName' | 'lastName'>) {
  return `${resource.firstName.charAt(0)}${resource.lastName.charAt(0)}`.toUpperCase();
}

function EditIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="m14 8 2 2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
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
