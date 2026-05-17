'use client';

import { Role } from '@prisma/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
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

export function MobileAdminUsersPage() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [page, setPage] = useState(1);
  const [role, setRole] = useState<'ALL' | Role>('ALL');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [search, setSearch] = useState('');
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null);
  const [statusTarget, setStatusTarget] = useState<UserListItem | null>(null);
  const [resetTarget, setResetTarget] = useState<UserListItem | null>(null);

  const usersQuery = useQuery({
    queryKey: ['mobile-admin-users', page, role, status, search],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), status });
      if (role !== 'ALL') params.set('role', role);
      if (search.trim()) params.set('search', search.trim());
      const response = await authFetch(`/api/users?${params}`);
      if (!response.ok) throw new Error('Chargement impossible.');
      return (await response.json()) as PaginatedUsersResponse;
    },
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: async (values: UserFormValues) => {
      const isEdit = Boolean(editingUser);
      const response = await authFetch(isEdit ? `/api/users/${editingUser!.id}` : '/api/users', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isEdit
            ? { firstName: values.firstName, lastName: values.lastName, role: values.role }
            : values,
        ),
      });
      if (!response.ok) throw new Error((await readMessage(response)) ?? 'Sauvegarde impossible.');
      return (await response.json()) as { user: UserDetail; temporaryPassword?: string };
    },
    onSuccess: (payload) => {
      void queryClient.invalidateQueries({ queryKey: ['mobile-admin-users'] });
      setFormMode(null);
      setEditingUser(null);
      pushToast(
        payload.temporaryPassword
          ? {
              type: 'success',
              title: 'Utilisateur cree',
              message: `Mot de passe temporaire : ${payload.temporaryPassword}`,
            }
          : {
              type: 'success',
              title: 'Utilisateur mis a jour',
            },
      );
    },
    onError: (error) => pushToast({ type: 'error', title: 'Sauvegarde impossible', message: getErrorMessage(error) }),
  });

  const statusMutation = useMutation({
    mutationFn: async (user: UserListItem) => {
      const response = await authFetch(`/api/users/${user.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      if (!response.ok) throw new Error((await readMessage(response)) ?? 'Changement de statut impossible.');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mobile-admin-users'] });
      setStatusTarget(null);
      pushToast({ type: 'success', title: 'Statut mis a jour' });
    },
    onError: (error) => pushToast({ type: 'error', title: 'Statut impossible', message: getErrorMessage(error) }),
  });

  const resetMutation = useMutation({
    mutationFn: async (user: UserListItem) => {
      const response = await authFetch(`/api/users/${user.id}/reset-password`, { method: 'POST' });
      if (!response.ok && response.status !== 204) {
        throw new Error((await readMessage(response)) ?? 'Reinitialisation impossible.');
      }
    },
    onSuccess: () => {
      setResetTarget(null);
      pushToast({ type: 'success', title: 'Mot de passe reinitialise', message: 'Nouveau mot de passe : 12345678' });
    },
    onError: (error) => pushToast({ type: 'error', title: 'Reset impossible', message: getErrorMessage(error) }),
  });

  return (
    <div className="space-y-4 pb-20">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Administration</p>
            <h1 className="mt-2 text-xl font-black text-slate-950">Utilisateurs</h1>
          </div>
          <button
            className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-bold text-white"
            onClick={() => {
              setEditingUser(null);
              setFormMode('create');
            }}
            type="button"
          >
            Creer
          </button>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
        <input
          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm"
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Nom, prenom, email..."
          value={search}
        />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Role" onChange={(value) => { setRole(value as 'ALL' | Role); setPage(1); }} value={role}>
            <option value="ALL">Tous</option>
            {ROLE_OPTIONS.map((item) => <option key={item} value={item}>{formatRole(item)}</option>)}
          </SelectField>
          <SelectField label="Statut" onChange={(value) => { setStatus(value as typeof status); setPage(1); }} value={status}>
            <option value="all">Tous</option>
            <option value="active">Actifs</option>
            <option value="inactive">Inactifs</option>
          </SelectField>
        </div>
      </section>

      {usersQuery.isLoading ? <InfoPanel text="Chargement des utilisateurs..." /> : null}
      {usersQuery.isError ? <InfoPanel tone="error" text="La liste des utilisateurs est indisponible." /> : null}
      {!usersQuery.isLoading && !usersQuery.isError && (usersQuery.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="Aucun utilisateur" description="Aucun compte ne correspond a ces filtres." />
      ) : null}

      <section className="space-y-3">
        {usersQuery.data?.items.map((user) => (
          <article key={user.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-black text-slate-950">{user.firstName} {user.lastName}</h2>
                <p className="mt-1 truncate text-sm text-slate-500">{user.email}</p>
              </div>
              <Badge tone={user.isActive ? 'success' : 'warning'}>{user.isActive ? 'Actif' : 'Inactif'}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone="neutral">{formatRole(user.role)}</Badge>
              <span className="text-xs font-semibold text-slate-500">
                Cree le {formatDate(user.createdAt)}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <ActionButton label="Modifier" onClick={() => { setEditingUser(user); setFormMode('edit'); }} />
              <ActionButton label="Reset MDP" onClick={() => setResetTarget(user)} />
              <ActionButton label={user.isActive ? 'Desactiver' : 'Reactiver'} onClick={() => setStatusTarget(user)} />
            </div>
          </article>
        ))}
      </section>

      <Pagination page={usersQuery.data?.page ?? page} totalPages={usersQuery.data?.totalPages ?? 1} onPageChange={setPage} />
      <UserFormSheet mode={formMode} user={editingUser} pending={saveMutation.isPending} onClose={() => setFormMode(null)} onSubmit={(values) => saveMutation.mutate(values)} />
      <ConfirmModal
        open={Boolean(statusTarget)}
        title={statusTarget?.isActive ? 'Desactiver ce compte ?' : 'Reactiver ce compte ?'}
        description={statusTarget?.isActive ? 'Le compte ne pourra plus se connecter.' : 'Le compte pourra de nouveau se connecter.'}
        confirmLabel={statusTarget?.isActive ? 'Desactiver' : 'Reactiver'}
        cancelLabel="Annuler"
        destructive={Boolean(statusTarget?.isActive)}
        onClose={() => setStatusTarget(null)}
        onConfirm={() => statusTarget && statusMutation.mutate(statusTarget)}
      />
      <ConfirmModal
        open={Boolean(resetTarget)}
        title="Reinitialiser le mot de passe ?"
        description="Le mot de passe sera remis a 12345678."
        confirmLabel="Reinitialiser"
        cancelLabel="Annuler"
        onClose={() => setResetTarget(null)}
        onConfirm={() => resetTarget && resetMutation.mutate(resetTarget)}
      />
    </div>
  );
}

function SelectField({ label, value, onChange, children }: Readonly<{ label: string; value: string; onChange: (value: string) => void; children: ReactNode }>) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <select className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm" onChange={(event) => onChange(event.target.value)} value={value}>
        {children}
      </select>
    </label>
  );
}

function UserFormSheet({ mode, user, pending, onClose, onSubmit }: Readonly<{ mode: 'create' | 'edit' | null; user: UserListItem | null; pending: boolean; onClose: () => void; onSubmit: (values: UserFormValues) => void }>) {
  const [values, setValues] = useState<UserFormValues>(() => buildValues(user));
  useEffect(() => setValues(buildValues(user)), [user, mode]);
  if (!mode) return null;
  const canSubmit = values.email.trim() && values.firstName.trim() && values.lastName.trim();
  return (
    <div className="fixed inset-0 z-[75] flex items-end bg-slate-950/45">
      <div className="max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-slate-950">{mode === 'create' ? 'Nouvel utilisateur' : 'Modifier utilisateur'}</h2>
          <button className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold" onClick={onClose} type="button">Fermer</button>
        </div>
        <div className="mt-5 space-y-3">
          <TextField disabled={mode === 'edit'} label="Email" value={values.email} onChange={(email) => setValues((current) => ({ ...current, email }))} />
          <TextField label="Prenom" value={values.firstName} onChange={(firstName) => setValues((current) => ({ ...current, firstName }))} />
          <TextField label="Nom" value={values.lastName} onChange={(lastName) => setValues((current) => ({ ...current, lastName }))} />
          <SelectField label="Role" onChange={(role) => setValues((current) => ({ ...current, role: role as Role }))} value={values.role}>
            {ROLE_OPTIONS.map((item) => <option key={item} value={item}>{formatRole(item)}</option>)}
          </SelectField>
        </div>
        <button className="mt-5 w-full rounded-lg bg-slate-950 px-4 py-3 text-sm font-bold text-white disabled:opacity-50" disabled={!canSubmit || pending} onClick={() => onSubmit(values)} type="button">
          {pending ? 'Enregistrement...' : mode === 'create' ? 'Creer' : 'Mettre a jour'}
        </button>
      </div>
    </div>
  );
}

function TextField({ label, value, disabled = false, onChange }: Readonly<{ label: string; value: string; disabled?: boolean; onChange: (value: string) => void }>) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <input className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm disabled:text-slate-400" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function ActionButton({ label, onClick }: Readonly<{ label: string; onClick: () => void }>) {
  return <button className="rounded-lg border border-slate-200 px-2 py-2 text-xs font-bold text-slate-700" onClick={onClick} type="button">{label}</button>;
}

function Pagination({ page, totalPages, onPageChange }: Readonly<{ page: number; totalPages: number; onPageChange: (page: number) => void }>) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="font-semibold text-slate-500">Page {page} / {totalPages}</span>
      <div className="flex gap-2">
        <ActionButton label="Precedent" onClick={() => onPageChange(Math.max(1, page - 1))} />
        <ActionButton label="Suivant" onClick={() => onPageChange(Math.min(totalPages, page + 1))} />
      </div>
    </div>
  );
}

function InfoPanel({ text, tone = 'neutral' }: Readonly<{ text: string; tone?: 'neutral' | 'error' }>) {
  return <div className={`rounded-lg border p-4 text-sm font-semibold ${tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'}`}>{text}</div>;
}

function buildValues(user: UserListItem | null): UserFormValues {
  return { email: user?.email ?? '', firstName: user?.firstName ?? '', lastName: user?.lastName ?? '', role: user?.role ?? Role.SUPERVISOR };
}

function formatRole(role: Role) { return role.replaceAll('_', ' '); }
function formatDate(value: string) { return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(value)); }
function getErrorMessage(error: unknown) { return error instanceof Error ? error.message : 'Une erreur est survenue.'; }
async function readMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message;
  } catch {
    return null;
  }
}
