'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { SearchableSelect } from '@/components/searchable-select';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import { formatRoleLabel } from '@/lib/role-labels';
import type {
  AdminClockInSessionItem,
  AdminClockInSessionsResponse,
  AdminClockInSessionStatus,
} from '@/types/admin-clock-in-sessions';
import type { PaginatedUsersResponse } from '@/types/users';

const inputClassName =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white';

const statuses: { value: AdminClockInSessionStatus; label: string }[] = [
  { value: 'OPEN', label: 'En cours' },
  { value: 'FORGOTTEN_EXIT', label: 'Sortie oubliee' },
  { value: 'CLOSED', label: 'Fermee' },
  { value: 'CLOSED_BY_ADMIN', label: 'Fermee par admin' },
  { value: 'REMOTE_CHECKOUT', label: 'Sortie distante' },
  { value: 'ANOMALY', label: 'Anomalie' },
];

export function AdminClockInSessionsPage() {
  const { pushToast } = useToast();
  const searchParams = useSearchParams();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(() => {
    const value = new Date(`${today}T00:00:00.000Z`);
    value.setUTCDate(value.getUTCDate() - 7);
    return value.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(today);
  const [userId, setUserId] = useState('');
  const [context, setContext] = useState('');
  const [status, setStatus] = useState('');
  const [arrivalRecordId, setArrivalRecordId] = useState(() => searchParams.get('arrivalRecordId') ?? '');

  const requestPath = useMemo(() => {
    const searchParams = new URLSearchParams();
    if (from) searchParams.set('from', `${from}T00:00:00.000Z`);
    if (to) searchParams.set('to', `${to}T23:59:59.999Z`);
    if (userId) searchParams.set('userId', userId);
    if (context) searchParams.set('context', context);
    if (status) searchParams.set('status', status);
    if (arrivalRecordId) searchParams.set('arrivalRecordId', arrivalRecordId);
    return `/api/admin/clock-in-sessions?${searchParams.toString()}`;
  }, [arrivalRecordId, context, from, status, to, userId]);

  const sessionsQuery = useQuery({
    queryKey: ['admin-clock-in-sessions', requestPath],
    queryFn: async () => {
      const response = await authFetch(requestPath, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Sessions request failed with status ${response.status}`);
      }
      return (await response.json()) as AdminClockInSessionsResponse;
    },
    placeholderData: (previousData) => previousData,
  });

  const usersQuery = useQuery({
    queryKey: ['admin-clock-in-session-users'],
    queryFn: async () => {
      const response = await authFetch('/api/users?page=1&status=active&limit=500');
      if (!response.ok) {
        throw new Error('Liste utilisateurs indisponible.');
      }
      return (await response.json()) as PaginatedUsersResponse;
    },
  });

  const closeMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const response = await authFetch(`/api/admin/clock-in-sessions/${encodeURIComponent(sessionId)}/close`, {
        method: 'POST',
      });
      if (!response.ok) {
        const body = (await safeJson(response)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Fermeture impossible.');
      }
      return response.json() as Promise<{ recordId: string }>;
    },
    onSuccess: async () => {
      pushToast({ type: 'success', title: 'Session fermee' });
      await sessionsQuery.refetch();
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Fermeture impossible',
        message: error instanceof Error ? error.message : 'La session na pas pu etre fermee.',
      });
    },
  });

  const userOptions = useMemo(
    () =>
      (usersQuery.data?.items ?? []).map((user) => ({
        value: user.id,
        label: `${user.firstName} ${user.lastName}`,
        description: `${formatRoleLabel(user.role)}${user.matricule ? ` - ${user.matricule}` : ''}`,
        keywords: `${user.username} ${user.email ?? ''} ${user.matricule ?? ''}`,
      })),
    [usersQuery.data?.items],
  );

  const data = sessionsQuery.data;

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">Administration</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Sessions de pointage</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Diagnostique les entrees, sorties, sessions ouvertes et sorties oubliees sans surcharger la liste de presence RH.
            </p>
          </div>
          <button
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={() => void sessionsQuery.refetch()}
            type="button"
          >
            Actualiser
          </button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Total" value={data?.summary.total ?? 0} />
        <Kpi label="En cours" tone="success" value={data?.summary.open ?? 0} />
        <Kpi label="Sorties oubliees" tone="danger" value={data?.summary.forgotten ?? 0} />
        <Kpi label="Sorties distantes" tone="warning" value={data?.summary.remote ?? 0} />
        <Kpi label="Anomalies" tone="danger" value={data?.summary.anomalies ?? 0} />
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Field label="Du">
            <input className={inputClassName} onChange={(event) => setFrom(event.target.value)} type="date" value={from} />
          </Field>
          <Field label="Au">
            <input className={inputClassName} onChange={(event) => setTo(event.target.value)} type="date" value={to} />
          </Field>
          <Field label="Ressource">
            <SearchableSelect onChange={setUserId} options={userOptions} placeholder="Toutes les ressources" value={userId} />
          </Field>
          <Field label="Contexte">
            <select className={inputClassName} onChange={(event) => setContext(event.target.value)} value={context}>
              <option value="">Tous les contextes</option>
              <option value="OFFICE">Bureau</option>
              <option value="SITE">Chantier</option>
              <option value="FREE_MISSION">Zone</option>
            </select>
          </Field>
          <Field label="Statut">
            <select className={inputClassName} onChange={(event) => setStatus(event.target.value)} value={status}>
              <option value="">Tous les statuts</option>
              {statuses.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </Field>
        </div>
        {arrivalRecordId ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-orange-100 bg-orange-50 p-3 text-sm font-semibold text-orange-900">
            <span>Session ciblee directement.</span>
            <button
              className="rounded-full bg-white px-3 py-1 text-xs font-black text-orange-700 transition hover:bg-orange-100"
              onClick={() => setArrivalRecordId('')}
              type="button"
            >
              Retirer le filtre direct
            </button>
          </div>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-panel">
        {sessionsQuery.isLoading && !data ? (
          <p className="p-8 text-center text-sm text-slate-500">Chargement des sessions...</p>
        ) : sessionsQuery.isError ? (
          <div className="p-6">
            <EmptyState description="Les sessions de pointage ne peuvent pas etre chargees." title="Sessions indisponibles" />
          </div>
        ) : (data?.items.length ?? 0) === 0 ? (
          <div className="p-6">
            <EmptyState description="Aucune session ne correspond aux filtres." title="Aucune session" />
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {data?.items.map((session) => (
              <SessionRow
                closePending={closeMutation.isPending}
                key={session.sessionId}
                onClose={() => closeMutation.mutate(session.sessionId)}
                session={session}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SessionRow({
  closePending,
  onClose,
  session,
}: Readonly<{
  closePending: boolean;
  onClose: () => void;
  session: AdminClockInSessionItem;
}>) {
  return (
    <article className="p-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_auto_auto] xl:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-base font-semibold text-slate-950">
              {session.user.firstName} {session.user.lastName}
            </p>
            <Badge tone={statusTone(session.status)}>{statusLabel(session.status)}</Badge>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-600">
              {contextLabel(session.context)}
            </span>
          </div>
          <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
            {formatRoleLabel(session.user.role)}{session.user.matricule ? ` - ${session.user.matricule}` : ''}
          </p>
        </div>
        <div className="text-sm text-slate-700">
          <p className="font-semibold text-slate-950">{session.contextLabel}</p>
          <p className="mt-1 text-xs text-slate-500">{session.projectName ?? 'Sans projet'}</p>
          {session.taskAction ? <p className="mt-1 text-xs text-slate-500">Tache : {session.taskAction}</p> : null}
        </div>
        <div className="text-sm font-semibold text-slate-700">
          <p>Entree : {formatDateTime(session.arrivalRecord.recordedAt)}</p>
          <p className="mt-1">Sortie : {session.departureRecord ? formatDateTime(session.departureRecord.recordedAt) : '-'}</p>
          <p className="mt-1 text-xs text-slate-500">Duree : {formatDuration(session.durationSeconds)}</p>
        </div>
        <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
          {session.canClose ? (
            <button
              className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={closePending}
              onClick={onClose}
              type="button"
            >
              {closePending ? 'Fermeture...' : 'Fermer la session'}
            </button>
          ) : null}
        </div>
      </div>

      <details className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <summary className="cursor-pointer font-bold text-slate-700">Chronologie et positions GPS</summary>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {session.timeline.map((record) => (
            <div className="rounded-2xl bg-white p-3" key={record.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-slate-950">{clockInTypeLabel(record.type)}</p>
                <p className="text-xs font-bold text-slate-500">{formatDateTime(record.recordedAt)}</p>
              </div>
              <p className="mt-2 text-xs text-slate-500">{record.comment ?? 'Aucun commentaire'}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {record.latitude !== null && record.longitude !== null ? (
                  <a
                    className="rounded-full bg-slate-950 px-3 py-2 text-xs font-bold text-white transition hover:bg-slate-800"
                    href={buildGpsMapUrl(record.latitude, record.longitude)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Voir position
                  </a>
                ) : (
                  <span className="text-xs text-slate-400">Position GPS indisponible</span>
                )}
                {record.isRemoteCheckout ? <Badge tone="warning">Sortie distante</Badge> : null}
                {record.isRegularized ? <Badge tone="info">Regularisee</Badge> : null}
              </div>
            </div>
          ))}
        </div>
      </details>
    </article>
  );
}

function Kpi({
  label,
  value,
  tone = 'neutral',
}: Readonly<{
  label: string;
  value: number;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}>) {
  const className = {
    neutral: 'border-slate-200 bg-white text-slate-950',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    warning: 'border-orange-200 bg-orange-50 text-orange-950',
    danger: 'border-red-200 bg-red-50 text-red-950',
  }[tone];

  return (
    <article className={`rounded-[2rem] border p-5 shadow-panel ${className}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-70">{label}</p>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
    </article>
  );
}

function Field({ children, label }: Readonly<{ children: ReactNode; label: string }>) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function statusLabel(status: AdminClockInSessionStatus) {
  return statuses.find((item) => item.value === status)?.label ?? status;
}

function statusTone(status: AdminClockInSessionStatus): 'neutral' | 'success' | 'warning' | 'error' | 'info' {
  if (status === 'OPEN') return 'success';
  if (status === 'FORGOTTEN_EXIT' || status === 'ANOMALY') return 'error';
  if (status === 'REMOTE_CHECKOUT') return 'warning';
  if (status === 'CLOSED_BY_ADMIN') return 'info';
  return 'neutral';
}

function contextLabel(context: AdminClockInSessionItem['context']) {
  if (context === 'OFFICE') return 'Bureau';
  if (context === 'FREE_MISSION') return 'Zone';
  return 'Chantier';
}

function clockInTypeLabel(type: string) {
  if (type === 'ARRIVAL') return 'Entree';
  if (type === 'DEPARTURE') return 'Sortie';
  if (type === 'PAUSE_START') return 'Debut pause';
  if (type === 'PAUSE_END') return 'Fin pause';
  return type;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDuration(value: number | null) {
  if (value === null) return '-';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return `${hours}h${String(minutes).padStart(2, '0')}`;
}

function buildGpsMapUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

async function safeJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
