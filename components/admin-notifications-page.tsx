'use client';

import { useMemo, useState } from 'react';
import { Role, UserNotificationAudience } from '@prisma/client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { SearchableMultiSelect } from '@/components/searchable-select';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import { formatRoleLabel } from '@/lib/role-labels';
import type { CreateUserNotificationRequest } from '@/types/notifications';
import type { PaginatedUsersResponse } from '@/types/users';

const audienceOptions: { value: UserNotificationAudience; label: string; description: string }[] = [
  {
    value: UserNotificationAudience.ALL,
    label: 'Tous les utilisateurs',
    description: 'Le message sera visible par tous les comptes actifs.',
  },
  {
    value: UserNotificationAudience.ROLE,
    label: 'Un rôle',
    description: 'Le message sera envoyé aux utilisateurs actifs du rôle choisi.',
  },
  {
    value: UserNotificationAudience.USERS,
    label: 'Utilisateurs précis',
    description: 'Le message sera envoyé uniquement à la sélection.',
  },
];

export function AdminNotificationsPage() {
  const { pushToast } = useToast();
  const [title, setTitle] = useState('Veuillez renseigner votre matricule');
  const [message, setMessage] = useState('Merci de compléter votre matricule depuis votre profil.');
  const [audience, setAudience] = useState<UserNotificationAudience>(UserNotificationAudience.ALL);
  const [targetRoles, setTargetRoles] = useState<Role[]>([Role.RESOURCE]);
  const [userIds, setUserIds] = useState<string[]>([]);

  const usersQuery = useQuery({
    queryKey: ['admin-notification-users'],
    queryFn: async () => {
      const response = await authFetch('/api/users?page=1&status=active&limit=500');
      if (!response.ok) {
        throw new Error('Liste utilisateurs indisponible.');
      }

      return (await response.json()) as PaginatedUsersResponse;
    },
  });

  const userOptions = useMemo(
    () =>
      (usersQuery.data?.items ?? []).map((user) => ({
        value: user.id,
        label: `${user.firstName} ${user.lastName}`,
        description: `${formatRoleLabel(user.role)}${user.matricule ? ` · ${user.matricule}` : ''}`,
        keywords: `${user.username} ${user.email ?? ''} ${user.matricule ?? ''}`,
      })),
    [usersQuery.data?.items],
  );

  const sendMutation = useMutation({
    mutationFn: async () => {
      const payload: CreateUserNotificationRequest = {
        title: title.trim(),
        message: message.trim(),
        audience,
        ...(audience === UserNotificationAudience.ROLE ? { targetRoles } : {}),
        ...(audience === UserNotificationAudience.USERS ? { userIds } : {}),
      };

      const response = await authFetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await safeJson(response)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Notification impossible.');
      }

      return (await response.json()) as { recipientCount: number };
    },
    onSuccess: (result) => {
      pushToast({
        type: 'success',
        title: 'Notification envoyée',
        message: `${result.recipientCount} destinataire(s).`,
      });
      if (audience === UserNotificationAudience.USERS) {
        setUserIds([]);
      }
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Envoi impossible',
        message: error instanceof Error ? error.message : 'Vérifie les informations.',
      });
    },
  });

  const canSubmit =
    title.trim().length >= 3 &&
    message.trim().length >= 3 &&
    (audience !== UserNotificationAudience.ROLE || targetRoles.length > 0) &&
    (audience !== UserNotificationAudience.USERS || userIds.length > 0);

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">Administration</p>
            <h1 className="mt-2 text-3xl font-black text-slate-950">Notifications</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Envoie un message interne aux utilisateurs. Les notifications apparaissent dans la barre du haut web et
              dans l’application mobile.
            </p>
          </div>
          <Badge tone="info">Interne application</Badge>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
          <div className="space-y-5">
            <label className="block text-sm font-bold text-slate-700">
              Titre
              <input
                className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-500"
                maxLength={80}
                onChange={(event) => setTitle(event.target.value)}
                value={title}
              />
            </label>

            <label className="block text-sm font-bold text-slate-700">
              Message
              <textarea
                className="mt-2 min-h-32 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-500"
                maxLength={500}
                onChange={(event) => setMessage(event.target.value)}
                value={message}
              />
            </label>

            <div>
              <p className="text-sm font-bold text-slate-700">Destinataires</p>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {audienceOptions.map((option) => (
                  <button
                    className={`rounded-2xl border p-4 text-left transition ${
                      audience === option.value
                        ? 'border-slate-950 bg-slate-950 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                    key={option.value}
                    onClick={() => setAudience(option.value)}
                    type="button"
                  >
                    <span className="block text-sm font-black">{option.label}</span>
                    <span className={`mt-1 block text-xs leading-5 ${audience === option.value ? 'text-slate-200' : 'text-slate-500'}`}>
                      {option.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {audience === UserNotificationAudience.ROLE ? (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-bold text-slate-700">Roles concernes</p>
                  <div className="flex gap-2">
                    <button
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
                      onClick={() => setTargetRoles(Object.values(Role))}
                      type="button"
                    >
                      Tout cocher
                    </button>
                    <button
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
                      onClick={() => setTargetRoles([])}
                      type="button"
                    >
                      Effacer
                    </button>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {Object.values(Role).map((role) => (
                    <label
                      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-bold transition ${
                        targetRoles.includes(role)
                          ? 'border-slate-950 bg-slate-950 text-white'
                          : 'border-slate-200 bg-white text-slate-700'
                      }`}
                      key={role}
                    >
                      <input
                        checked={targetRoles.includes(role)}
                        className="h-4 w-4"
                        onChange={(event) => {
                          setTargetRoles((current) =>
                            event.target.checked
                              ? [...new Set([...current, role])]
                              : current.filter((item) => item !== role),
                          );
                        }}
                        type="checkbox"
                      />
                      {formatRoleLabel(role)}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {audience === UserNotificationAudience.USERS ? (
              <div>
                <p className="text-sm font-bold text-slate-700">Utilisateurs</p>
                <div className="mt-2">
                  <SearchableMultiSelect
                    emptyLabel="Aucun utilisateur trouvé."
                    onChange={setUserIds}
                    options={userOptions}
                    placeholder="Rechercher par nom, username, email ou matricule"
                    values={userIds}
                  />
                </div>
              </div>
            ) : null}

            <button
              className="rounded-2xl bg-orange-600 px-5 py-3 text-sm font-black text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canSubmit || sendMutation.isPending}
              onClick={() => sendMutation.mutate()}
              type="button"
            >
              {sendMutation.isPending ? 'Envoi...' : 'Envoyer la notification'}
            </button>
          </div>
        </div>

        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">Aperçu</p>
          <div className="mt-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-black text-slate-950">{title.trim() || 'Titre de notification'}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{message.trim() || 'Message visible par les utilisateurs.'}</p>
          </div>
          <div className="mt-5 rounded-3xl border border-dashed border-slate-300 p-4">
            <p className="text-sm font-black text-slate-800">Conseil</p>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Pour les demandes administratives, garde un message court : “Renseignez votre matricule” ou “Changez
              votre mot de passe”.
            </p>
          </div>
          {usersQuery.isError ? <EmptyState title="Utilisateurs indisponibles" description="La sélection nominative ne peut pas être chargée." /> : null}
        </div>
      </section>
    </div>
  );
}

async function safeJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
