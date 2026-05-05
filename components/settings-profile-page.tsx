'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast-provider';
import { clearAccessToken } from '@/lib/auth/client-session';
import { authFetch } from '@/lib/auth/client-session';
import type { UserDetail } from '@/types/users';

type ProfileFormValues = {
  firstName: string;
  lastName: string;
};

type PasswordFormValues = {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
};

const initialPasswordValues: PasswordFormValues = {
  currentPassword: '',
  newPassword: '',
  confirmation: '',
};

export function SettingsProfilePage() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [profileValues, setProfileValues] = useState<ProfileFormValues>({ firstName: '', lastName: '' });
  const [passwordValues, setPasswordValues] = useState<PasswordFormValues>(initialPasswordValues);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ['settings-profile'],
    queryFn: async () => {
      const response = await authFetch('/api/users/me');
      if (!response.ok) {
        throw new Error(`Profile request failed with status ${response.status}`);
      }

      return ((await response.json()) as { user: UserDetail }).user;
    },
  });

  useEffect(() => {
    if (profileQuery.data) {
      setProfileValues({
        firstName: profileQuery.data.firstName,
        lastName: profileQuery.data.lastName,
      });
    }
  }, [profileQuery.data]);

  const profileMutation = useMutation({
    mutationFn: async (values: ProfileFormValues) => {
      const response = await authFetch('/api/users/me', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Mise a jour impossible.');
      }

      return ((await response.json()) as { user: UserDetail }).user;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['auth-me'] });
      pushToast({ type: 'success', title: 'Profil mis a jour' });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Mise a jour impossible',
        message: error instanceof Error ? error.message : "Le profil n'a pas pu etre mis a jour.",
      });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: async (values: PasswordFormValues) => {
      if (values.newPassword !== values.confirmation) {
        throw new Error('La confirmation ne correspond pas au nouveau mot de passe.');
      }

      const response = await authFetch('/api/users/me/password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }),
      });

      if (!response.ok && response.status !== 204) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Changement de mot de passe impossible.');
      }
    },
    onSuccess: () => {
      setPasswordValues(initialPasswordValues);
      setPasswordError(null);
      clearAccessToken();
      pushToast({ type: 'success', title: 'Mot de passe modifie', message: 'Reconnexion requise.' });
      window.setTimeout(() => {
        window.location.href = '/web/login';
      }, 700);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Le mot de passe n'a pas pu etre modifie.";
      setPasswordError(message);
      pushToast({
        type: 'error',
        title: 'Changement impossible',
        message,
      });
    },
  });

  if (profileQuery.isLoading) {
    return <LoadingCard message="Chargement du profil..." />;
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <EmptyState
        description="Le profil n'a pas pu etre charge. Reconnecte-toi puis reessaie."
        title="Profil indisponible"
      />
    );
  }

  const user = profileQuery.data;
  const profileSubmitDisabled =
    profileMutation.isPending ||
    !profileValues.firstName.trim() ||
    !profileValues.lastName.trim() ||
    (profileValues.firstName.trim() === user.firstName && profileValues.lastName.trim() === user.lastName);
  const passwordSubmitDisabled =
    passwordMutation.isPending ||
    !passwordValues.currentPassword ||
    !passwordValues.newPassword ||
    !passwordValues.confirmation ||
    passwordValues.newPassword !== passwordValues.confirmation;

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Parametres</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Mon profil</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Consulte tes informations de compte, mets a jour ton nom et change ton mot de passe.
            </p>
          </div>
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-950 text-xl font-semibold text-white">
            {buildInitials(user)}
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1.1fr]">
        <article className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
          <h2 className="text-xl font-semibold text-slate-950">Informations du compte</h2>
          <div className="mt-5 grid gap-4">
            <ReadOnlyField label="Prenom" value={user.firstName} />
            <ReadOnlyField label="Nom" value={user.lastName} />
            <ReadOnlyField label="Email" value={user.email} />
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Role</p>
              <Badge tone="neutral">{user.role.replaceAll('_', ' ')}</Badge>
            </div>
            <ReadOnlyField label="Date creation" value={formatDate(user.createdAt)} />
          </div>
        </article>

        <article className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
          <h2 className="text-xl font-semibold text-slate-950">Modifier mon nom</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Prenom">
              <input
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => setProfileValues((current) => ({ ...current, firstName: event.target.value }))}
                value={profileValues.firstName}
              />
            </Field>
            <Field label="Nom">
              <input
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => setProfileValues((current) => ({ ...current, lastName: event.target.value }))}
                value={profileValues.lastName}
              />
            </Field>
          </div>
          <div className="mt-6 flex justify-end">
            <button
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={profileSubmitDisabled}
              onClick={() => profileMutation.mutate(profileValues)}
              type="button"
            >
              {profileMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </article>
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <h2 className="text-xl font-semibold text-slate-950">Changer le mot de passe</h2>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          <Field label="Ancien mot de passe">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setPasswordError(null);
                setPasswordValues((current) => ({ ...current, currentPassword: event.target.value }));
              }}
              type="password"
              value={passwordValues.currentPassword}
            />
          </Field>
          <Field label="Nouveau mot de passe">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setPasswordError(null);
                setPasswordValues((current) => ({ ...current, newPassword: event.target.value }));
              }}
              type="password"
              value={passwordValues.newPassword}
            />
          </Field>
          <Field label="Confirmation">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setPasswordError(null);
                setPasswordValues((current) => ({ ...current, confirmation: event.target.value }));
              }}
              type="password"
              value={passwordValues.confirmation}
            />
          </Field>
        </div>
        {passwordValues.confirmation && passwordValues.newPassword !== passwordValues.confirmation ? (
          <p className="mt-3 text-sm font-medium text-red-600">La confirmation ne correspond pas au nouveau mot de passe.</p>
        ) : null}
        {passwordError ? <p className="mt-3 text-sm font-medium text-red-600">{passwordError}</p> : null}
        <div className="mt-6 flex justify-end">
          <button
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={passwordSubmitDisabled}
            onClick={() => passwordMutation.mutate(passwordValues)}
            type="button"
          >
            {passwordMutation.isPending ? 'Modification...' : 'Changer le mot de passe'}
          </button>
        </div>
      </section>
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

function ReadOnlyField({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800">
        {value}
      </p>
    </div>
  );
}

function LoadingCard({ message }: Readonly<{ message: string }>) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

function buildInitials(user: UserDetail) {
  return `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(value));
}

async function safeJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
