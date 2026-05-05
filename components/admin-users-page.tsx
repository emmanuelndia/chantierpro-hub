'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Role } from '@prisma/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/badge';
import { ConfirmModal } from '@/components/confirm-modal';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import type { PaginatedUsersResponse, UserDetail, UserListItem } from '@/types/users';

const ROLE_OPTIONS = Object.values(Role);

type UserFormValues = {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
};

export function AdminUsersPage() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [page, setPage] = useState(1);
  const [role, setRole] = useState<'ALL' | Role>('ALL');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [search, setSearch] = useState('');
  const [drawerMode, setDrawerMode] = useState<'create' | 'edit' | null>(null);
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null);
  const [statusTarget, setStatusTarget] = useState<UserListItem | null>(null);
  const [resetTarget, setResetTarget] = useState<UserListItem | null>(null);

  const usersQuery = useQuery({
    queryKey: ['admin-users', page, role, status, search],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      searchParams.set('page', String(page));
      searchParams.set('status', status);
      if (role !== 'ALL') {
        searchParams.set('role', role);
      }
      if (search.trim()) {
        searchParams.set('search', search.trim());
      }

      const response = await authFetch(`/api/users?${searchParams.toString()}`);
      if (!response.ok) {
        throw new Error(`Users request failed with status ${response.status}`);
      }

      return (await response.json()) as PaginatedUsersResponse;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (values: UserFormValues) => {
      const body = {
        email: values.email,
        firstName: values.firstName,
        lastName: values.lastName,
        role: values.role,
      };
      const response = await authFetch(editingUser ? `/api/users/${editingUser.id}` : '/api/users', {
        method: editingUser ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editingUser ? { firstName: values.firstName, lastName: values.lastName, role: values.role } : body),
      });

      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Sauvegarde impossible.');
      }

      return (await response.json()) as { user: UserDetail; temporaryPassword?: string };
    },
    onSuccess: (payload) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setDrawerMode(null);
      setEditingUser(null);
      pushToast(
        payload.temporaryPassword
          ? {
              type: 'success',
              title: 'Utilisateur cree',
              message: `Mot de passe par defaut : ${payload.temporaryPassword}`,
            }
          : {
              type: 'success',
              title: 'Utilisateur mis a jour',
            },
      );
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Sauvegarde impossible',
        message: error instanceof Error ? error.message : "L'utilisateur n'a pas pu etre sauvegarde.",
      });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (target: UserListItem) => {
      const response = await authFetch(`/api/users/${target.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isActive: !target.isActive }),
      });

      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Changement de statut impossible.');
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setStatusTarget(null);
      pushToast({ type: 'success', title: 'Statut mis a jour' });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Statut impossible',
        message: error instanceof Error ? error.message : "Le statut n'a pas pu etre modifie.",
      });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async (target: UserListItem) => {
      const response = await authFetch(`/api/users/${target.id}/reset-password`, {
        method: 'POST',
      });

      if (!response.ok && response.status !== 204) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Reinitialisation impossible.');
      }
    },
    onSuccess: () => {
      setResetTarget(null);
      pushToast({ type: 'success', title: 'Mot de passe reinitialise', message: 'Nouveau mot de passe : 12345678' });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Reinitialisation impossible',
        message: error instanceof Error ? error.message : "Le mot de passe n'a pas pu etre reinitialise.",
      });
    },
  });

  function resetFiltersPage() {
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Administration</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Utilisateurs</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Gestion des comptes, roles, statuts et reinitialisations de mot de passe.
            </p>
          </div>
          <button
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            onClick={() => {
              setEditingUser(null);
              setDrawerMode('create');
            }}
            type="button"
          >
            Creer un utilisateur
          </button>
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
        <div className="grid gap-4 lg:grid-cols-[1fr_0.75fr_0.75fr]">
          <Field label="Recherche">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setSearch(event.target.value);
                resetFiltersPage();
              }}
              placeholder="Nom, prenom ou email"
              value={search}
            />
          </Field>
          <Field label="Role">
            <select
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setRole(event.target.value as 'ALL' | Role);
                resetFiltersPage();
              }}
              value={role}
            >
              <option value="ALL">Tous les roles</option>
              {ROLE_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {formatRole(item)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Statut">
            <select
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setStatus(event.target.value as 'all' | 'active' | 'inactive');
                resetFiltersPage();
              }}
              value={status}
            >
              <option value="all">Tous</option>
              <option value="active">Actifs</option>
              <option value="inactive">Inactifs</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-panel">
        <div className="overflow-x-auto">
          <table className="min-w-[960px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-5 py-4 font-semibold">Nom</th>
                <th className="px-5 py-4 font-semibold">Email</th>
                <th className="px-5 py-4 font-semibold">Role</th>
                <th className="px-5 py-4 font-semibold">Statut</th>
                <th className="px-5 py-4 font-semibold">Derniere connexion</th>
                <th className="px-5 py-4 font-semibold">Date creation</th>
                <th className="px-5 py-4 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {usersQuery.isLoading ? (
                <tr>
                  <td className="px-5 py-10 text-center text-slate-500" colSpan={7}>
                    Chargement des utilisateurs...
                  </td>
                </tr>
              ) : usersQuery.isError ? (
                <tr>
                  <td className="px-5 py-10" colSpan={7}>
                    <EmptyState description="La liste des utilisateurs n'a pas pu etre chargee." title="Utilisateurs indisponibles" />
                  </td>
                </tr>
              ) : (usersQuery.data?.items.length ?? 0) === 0 ? (
                <tr>
                  <td className="px-5 py-10" colSpan={7}>
                    <EmptyState description="Aucun compte ne correspond a ces filtres." title="Aucun utilisateur" />
                  </td>
                </tr>
              ) : (
                usersQuery.data?.items.map((user) => (
                  <tr key={user.id} className="align-top hover:bg-slate-50">
                    <td className="px-5 py-4 font-semibold text-slate-950">
                      {user.firstName} {user.lastName}
                    </td>
                    <td className="px-5 py-4 text-slate-600">{user.email}</td>
                    <td className="px-5 py-4">
                      <Badge tone="neutral">{formatRole(user.role)}</Badge>
                    </td>
                    <td className="px-5 py-4">
                      <Badge tone={user.isActive ? 'success' : 'warning'}>{user.isActive ? 'Actif' : 'Inactif'}</Badge>
                    </td>
                    <td className="px-5 py-4 text-slate-600">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : '-'}</td>
                    <td className="px-5 py-4 text-slate-600">{formatDate(user.createdAt)}</td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                          onClick={() => {
                            setEditingUser(user);
                            setDrawerMode('edit');
                          }}
                          type="button"
                        >
                          Modifier
                        </button>
                        <button
                          className="rounded-full border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-700 transition hover:bg-orange-100"
                          onClick={() => setResetTarget(user)}
                          type="button"
                        >
                          Reset MDP
                        </button>
                        <button
                          className="rounded-full border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                          onClick={() => setStatusTarget(user)}
                          type="button"
                        >
                          {user.isActive ? 'Desactiver' : 'Reactiver'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationBar
          onNext={() => setPage((current) => current + 1)}
          onPrevious={() => setPage((current) => Math.max(1, current - 1))}
          page={usersQuery.data?.page ?? page}
          totalPages={usersQuery.data?.totalPages ?? 1}
        />
      </section>

      <UserDrawer
        mode={drawerMode}
        onClose={() => {
          setDrawerMode(null);
          setEditingUser(null);
        }}
        onSubmit={(values) => saveMutation.mutate(values)}
        pending={saveMutation.isPending}
        user={editingUser}
      />

      <ConfirmModal
        cancelLabel="Annuler"
        confirmLabel={statusTarget?.isActive ? 'Desactiver' : 'Reactiver'}
        description={
          statusTarget?.isActive
            ? 'Le compte ne pourra plus se connecter. Les donnees historiques resteront conservees.'
            : 'Le compte pourra de nouveau se connecter avec son mot de passe courant.'
        }
        destructive={Boolean(statusTarget?.isActive)}
        onClose={() => setStatusTarget(null)}
        onConfirm={() => {
          if (statusTarget) {
            statusMutation.mutate(statusTarget);
          }
        }}
        open={Boolean(statusTarget)}
        title={statusTarget?.isActive ? 'Desactiver ce compte ?' : 'Reactiver ce compte ?'}
      />

      <ConfirmModal
        cancelLabel="Annuler"
        confirmLabel="Reinitialiser"
        description="Le mot de passe sera remis a 12345678 et les sessions existantes seront revoquees. Aucun email ne sera envoye."
        onClose={() => setResetTarget(null)}
        onConfirm={() => {
          if (resetTarget) {
            resetMutation.mutate(resetTarget);
          }
        }}
        open={Boolean(resetTarget)}
        title="Reinitialiser le mot de passe ?"
      />
    </div>
  );
}

function UserDrawer({
  mode,
  user,
  pending,
  onSubmit,
  onClose,
}: Readonly<{
  mode: 'create' | 'edit' | null;
  user: UserListItem | null;
  pending: boolean;
  onSubmit: (values: UserFormValues) => void;
  onClose: () => void;
}>) {
  const [values, setValues] = useState<UserFormValues>(() => buildInitialValues(user));

  useEffect(() => {
    setValues(buildInitialValues(user));
  }, [user, mode]);

  if (!mode) {
    return null;
  }

  const canSubmit = values.email.trim() && values.firstName.trim() && values.lastName.trim() && values.role;

  return (
    <div className="fixed inset-0 z-[75] flex justify-end bg-slate-950/45">
      <div className="custom-scrollbar h-full w-full max-w-xl overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
              {mode === 'create' ? 'Creation' : 'Edition'}
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950">
              {mode === 'create' ? 'Nouvel utilisateur' : 'Modifier utilisateur'}
            </h2>
          </div>
          <button className="rounded-full border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50" onClick={onClose} type="button">
            Fermer
          </button>
        </div>

        <div className="mt-6 grid gap-4">
          <Field label="Email">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white disabled:text-slate-500"
              disabled={mode === 'edit'}
              onChange={(event) => setValues((current) => ({ ...current, email: event.target.value }))}
              value={values.email}
            />
          </Field>
          <Field label="Prenom">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => setValues((current) => ({ ...current, firstName: event.target.value }))}
              value={values.firstName}
            />
          </Field>
          <Field label="Nom">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => setValues((current) => ({ ...current, lastName: event.target.value }))}
              value={values.lastName}
            />
          </Field>
          <Field label="Role">
            <select
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => setValues((current) => ({ ...current, role: event.target.value as Role }))}
              value={values.role}
            >
              {ROLE_OPTIONS.map((item) => (
                <option key={item} value={item}>
                  {formatRole(item)}
                </option>
              ))}
            </select>
          </Field>
          {mode === 'create' ? (
            <p className="rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-orange-800">
              Mot de passe par defaut : <span className="font-semibold">12345678</span>
            </p>
          ) : null}
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <button className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" onClick={onClose} type="button">
            Annuler
          </button>
          <button
            className="rounded-full bg-slate-950 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending || !canSubmit}
            onClick={() => onSubmit(values)}
            type="button"
          >
            {pending ? 'Enregistrement...' : mode === 'create' ? 'Creer' : 'Mettre a jour'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function PaginationBar({
  page,
  totalPages,
  onPrevious,
  onNext,
}: Readonly<{
  page: number;
  totalPages: number;
  onPrevious: () => void;
  onNext: () => void;
}>) {
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-sm text-slate-500">
      <p>
        Page {page} / {totalPages}
      </p>
      <div className="flex gap-2">
        <button className="rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" disabled={page <= 1} onClick={onPrevious} type="button">
          Precedent
        </button>
        <button className="rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" disabled={page >= totalPages} onClick={onNext} type="button">
          Suivant
        </button>
      </div>
    </div>
  );
}

function buildInitialValues(user: UserListItem | null): UserFormValues {
  return {
    email: user?.email ?? '',
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    role: user?.role ?? 'SUPERVISOR',
  };
}

function formatRole(role: Role) {
  return role.replaceAll('_', ' ');
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

async function safeJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
