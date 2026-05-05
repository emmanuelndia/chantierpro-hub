'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Role } from '@prisma/client';
import { clearAccessToken, authFetch } from '@/lib/auth/client-session';
import {
  MOBILE_PHOTO_QUALITY_OPTIONS,
  getStoredMobilePhotoQuality,
  setStoredMobilePhotoQuality,
  type MobilePhotoQuality,
} from '@/lib/mobile-photo-quality';
import type { UserDetail } from '@/types/users';

type ProfileValues = {
  firstName: string;
  lastName: string;
};

type PasswordValues = {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
};

const initialPasswordValues: PasswordValues = {
  currentPassword: '',
  newPassword: '',
  confirmation: '',
};

const roleLabels: Record<Role, string> = {
  ADMIN: 'Administrateur',
  HR: 'Ressources humaines',
  SUPERVISOR: 'Chef de chantier',
  COORDINATOR: 'Coordinateur',
  GENERAL_SUPERVISOR: 'Superviseur général',
  PROJECT_MANAGER: 'Chef de projet',
  DIRECTION: 'Direction',
};

export function MobileProfilePage() {
  const queryClient = useQueryClient();
  const [profileValues, setProfileValues] = useState<ProfileValues>({ firstName: '', lastName: '' });
  const [passwordValues, setPasswordValues] = useState<PasswordValues>(initialPasswordValues);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [quality, setQuality] = useState<MobilePhotoQuality>('normal');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ['mobile-profile'],
    queryFn: async () => {
      const response = await authFetch('/api/users/me');

      if (!response.ok) {
        throw new Error('Profil indisponible.');
      }

      return ((await response.json()) as { user: UserDetail }).user;
    },
  });

  useEffect(() => {
    setQuality(getStoredMobilePhotoQuality());
  }, []);

  useEffect(() => {
    if (!profileQuery.data) {
      return;
    }

    setProfileValues({
      firstName: profileQuery.data.firstName,
      lastName: profileQuery.data.lastName,
    });
  }, [profileQuery.data]);

  const profileMutation = useMutation({
    mutationFn: async (values: ProfileValues) => {
      const response = await authFetch('/api/users/me', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
        }),
      });

      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Mise à jour impossible.');
      }

      return ((await response.json()) as { user: UserDetail }).user;
    },
    onSuccess: (user) => {
      setNotice({ tone: 'success', message: 'Profil mis à jour.' });
      setProfileValues({ firstName: user.firstName, lastName: user.lastName });
      void queryClient.invalidateQueries({ queryKey: ['mobile-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['auth-me'] });
    },
    onError: (error) => {
      setNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : "Le profil n'a pas pu être mis à jour.",
      });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: async (values: PasswordValues) => {
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

      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Changement de mot de passe impossible.');
      }
    },
    onSuccess: () => {
      setPasswordError(null);
      setPasswordValues(initialPasswordValues);
      setPasswordOpen(false);
      clearAccessToken();
      window.location.href = '/mobile/login';
    },
    onError: (error) => {
      setPasswordError(error instanceof Error ? error.message : "Le mot de passe n'a pas pu etre modifie.");
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await authFetch('/api/auth/logout', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Déconnexion impossible.');
      }
    },
    onSettled: () => {
      clearAccessToken();
      window.location.href = '/mobile/login';
    },
  });

  const user = profileQuery.data;
  const canSaveProfile = useMemo(() => {
    if (!user) {
      return false;
    }

    return (
      profileValues.firstName.trim().length > 0 &&
      profileValues.lastName.trim().length > 0 &&
      (profileValues.firstName.trim() !== user.firstName || profileValues.lastName.trim() !== user.lastName)
    );
  }, [profileValues.firstName, profileValues.lastName, user]);

  const passwordSubmitDisabled =
    passwordMutation.isPending ||
    !passwordValues.currentPassword ||
    !passwordValues.newPassword ||
    !passwordValues.confirmation ||
    passwordValues.newPassword !== passwordValues.confirmation;

  function updateQuality(value: MobilePhotoQuality) {
    setQuality(value);
    setStoredMobilePhotoQuality(value);
    setNotice({ tone: 'success', message: 'Qualité photo enregistrée.' });
  }

  if (profileQuery.isLoading) {
    return <LoadingState />;
  }

  if (profileQuery.isError || !user) {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 p-5 text-center">
        <p className="text-lg font-black text-red-900">Profil indisponible</p>
        <p className="mt-2 text-sm leading-6 text-red-700">
          Reconnecte-toi puis réessaie depuis le menu mobile.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-5 pb-4">
      <section className="rounded-lg bg-primary p-5 text-white shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-white text-2xl font-black text-primary">
            {buildInitials(user)}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-black">{user.firstName} {user.lastName}</h1>
            <p className="mt-1 text-sm font-semibold text-white/80">{roleLabels[user.role]}</p>
            <p className="mt-2 text-xs text-white/70">Inscrit le {formatDate(user.createdAt)}</p>
          </div>
        </div>
      </section>

      {notice ? <Notice tone={notice.tone}>{notice.message}</Notice> : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <SectionTitle title="Informations" />
        <div className="mt-4 space-y-3">
          <TextField
            label="Prénom"
            onChange={(value) => setProfileValues((current) => ({ ...current, firstName: value }))}
            value={profileValues.firstName}
          />
          <TextField
            label="Nom"
            onChange={(value) => setProfileValues((current) => ({ ...current, lastName: value }))}
            value={profileValues.lastName}
          />
          <ReadOnlyField label="Email" value={user.email} />
          <ReadOnlyField label="Rôle" value={roleLabels[user.role]} />
        </div>
        <button
          className="mt-4 flex min-h-14 w-full items-center justify-center rounded-lg bg-slate-950 px-5 text-base font-black text-white disabled:opacity-45"
          disabled={!canSaveProfile || profileMutation.isPending}
          onClick={() => profileMutation.mutate(profileValues)}
          type="button"
        >
          {profileMutation.isPending ? <Spinner className="h-5 w-5" /> : 'Enregistrer'}
        </button>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <SectionTitle title="Sécurité" />
        <button
          className="mt-4 flex min-h-14 w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 text-left text-sm font-black text-slate-950"
          onClick={() => {
            setPasswordError(null);
            setPasswordOpen(true);
          }}
          type="button"
        >
          Changer mon mot de passe
          <ChevronRightIcon className="h-5 w-5 text-slate-400" />
        </button>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <SectionTitle title="Synchronisation" />
        <Link
          className="mt-4 flex min-h-14 w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-4 text-left text-sm font-black text-slate-950"
          href="/mobile/sync"
        >
          Voir les elements en attente
          <ChevronRightIcon className="h-5 w-5 text-slate-400" />
        </Link>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <SectionTitle title="Qualité photo" />
        <div className="mt-4 grid gap-2">
          {MOBILE_PHOTO_QUALITY_OPTIONS.map((option) => (
            <button
              className={`flex min-h-14 items-center justify-between rounded-lg border px-4 text-left ${
                quality === option.value ? 'border-primary bg-primary/10 text-primary' : 'border-slate-200 bg-white text-slate-800'
              }`}
              key={option.value}
              onClick={() => updateQuality(option.value)}
              type="button"
            >
              <span className="font-black">{option.label}</span>
              <span className="text-sm font-bold opacity-70">{option.detail}</span>
            </button>
          ))}
        </div>
      </section>

      <button
        className="flex min-h-14 w-full items-center justify-center rounded-lg bg-red-600 px-5 text-base font-black text-white disabled:opacity-50"
        disabled={logoutMutation.isPending}
        onClick={() => setLogoutOpen(true)}
        type="button"
      >
        Se déconnecter
      </button>

      {passwordOpen ? (
        <Modal title="Changer mon mot de passe" onClose={() => setPasswordOpen(false)}>
          <div className="space-y-3">
            <PasswordField
              label="Mot de passe actuel"
              onChange={(value) => {
                setPasswordError(null);
                setPasswordValues((current) => ({ ...current, currentPassword: value }));
              }}
              value={passwordValues.currentPassword}
            />
            <PasswordField
              label="Nouveau mot de passe"
              onChange={(value) => {
                setPasswordError(null);
                setPasswordValues((current) => ({ ...current, newPassword: value }));
              }}
              value={passwordValues.newPassword}
            />
            <PasswordField
              label="Confirmation"
              onChange={(value) => {
                setPasswordError(null);
                setPasswordValues((current) => ({ ...current, confirmation: value }));
              }}
              value={passwordValues.confirmation}
            />
          </div>
          {passwordValues.confirmation && passwordValues.newPassword !== passwordValues.confirmation ? (
            <p className="mt-3 text-sm font-bold text-red-600">
              La confirmation ne correspond pas au nouveau mot de passe.
            </p>
          ) : null}
          {passwordError ? <p className="mt-3 text-sm font-bold text-red-600">{passwordError}</p> : null}
          <button
            className="mt-5 flex min-h-14 w-full items-center justify-center rounded-lg bg-slate-950 px-5 text-base font-black text-white disabled:opacity-45"
            disabled={passwordSubmitDisabled}
            onClick={() => passwordMutation.mutate(passwordValues)}
            type="button"
          >
            {passwordMutation.isPending ? <Spinner className="h-5 w-5" /> : 'Valider'}
          </button>
        </Modal>
      ) : null}

      {logoutOpen ? (
        <Modal title="Se déconnecter ?" onClose={() => setLogoutOpen(false)}>
          <p className="text-sm leading-6 text-slate-600">
            La session mobile sera fermée sur cet appareil et tu seras redirigé vers la connexion.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              className="min-h-14 rounded-lg border border-slate-200 px-4 text-sm font-black text-slate-700"
              disabled={logoutMutation.isPending}
              onClick={() => setLogoutOpen(false)}
              type="button"
            >
              Annuler
            </button>
            <button
              className="flex min-h-14 items-center justify-center rounded-lg bg-red-600 px-4 text-sm font-black text-white disabled:opacity-50"
              disabled={logoutMutation.isPending}
              onClick={() => logoutMutation.mutate()}
              type="button"
            >
              {logoutMutation.isPending ? <Spinner className="h-5 w-5" /> : 'Confirmer'}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function SectionTitle({ title }: Readonly<{ title: string }>) {
  return <h2 className="text-lg font-black text-slate-950">{title}</h2>;
}

function TextField({
  label,
  onChange,
  value,
}: Readonly<{
  label: string;
  onChange: (value: string) => void;
  value: string;
}>) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <input
        className="mt-2 min-h-14 w-full rounded-lg border border-slate-200 bg-white px-4 text-base font-semibold text-slate-950 outline-none focus:border-primary"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function PasswordField({
  label,
  onChange,
  value,
}: Readonly<{
  label: string;
  onChange: (value: string) => void;
  value: string;
}>) {
  return (
    <label className="block">
      <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <input
        className="mt-2 min-h-14 w-full rounded-lg border border-slate-200 bg-white px-4 text-base font-semibold text-slate-950 outline-none focus:border-primary"
        onChange={(event) => onChange(event.target.value)}
        type="password"
        value={value}
      />
    </label>
  );
}

function ReadOnlyField({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 min-h-14 rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-base font-semibold text-slate-500">
        {value}
      </p>
    </div>
  );
}

function Notice({ children, tone }: Readonly<{ children: ReactNode; tone: 'success' | 'error' }>) {
  return (
    <div
      className={`rounded-lg px-4 py-3 text-sm font-bold ${
        tone === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
      }`}
    >
      {children}
    </div>
  );
}

function Modal({
  children,
  onClose,
  title,
}: Readonly<{
  children: ReactNode;
  onClose: () => void;
  title: string;
}>) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/60 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
      <section className="w-full rounded-lg bg-white p-5 shadow-xl" role="dialog" aria-modal="true">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-slate-950">{title}</h2>
          <button
            aria-label="Fermer"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-600"
            onClick={onClose}
            type="button"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </section>
    </div>
  );
}

function LoadingState() {
  return (
    <section className="flex min-h-[60dvh] flex-col items-center justify-center rounded-lg border border-slate-200 bg-white p-5 text-center">
      <Spinner className="h-10 w-10 text-primary" />
      <p className="mt-4 text-sm font-bold text-slate-500">Chargement du profil...</p>
    </section>
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

function Spinner({ className }: Readonly<{ className: string }>) {
  return (
    <svg aria-hidden="true" className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeLinecap="round" strokeWidth="4" />
    </svg>
  );
}

function ChevronRightIcon({ className }: Readonly<{ className: string }>) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="m9 5 7 7-7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

function CloseIcon({ className }: Readonly<{ className: string }>) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}
