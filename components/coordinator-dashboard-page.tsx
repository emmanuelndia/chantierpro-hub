'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { StatsCard } from '@/components/stats-card';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import type {
  CoordinatorDashboardData,
  CoordinatorPendingReportItem,
  CoordinatorSupervisorWithoutReportItem,
  DashboardAlertItem,
} from '@/types/dashboard';

const REFRESH_INTERVAL_MS = 30_000;

export function CoordinatorDashboardPage() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const query = useQuery({
    queryKey: ['dashboard', 'coordinator'],
    queryFn: fetchCoordinatorDashboard,
    refetchInterval: REFRESH_INTERVAL_MS,
    staleTime: 30_000,
  });

  const validateMutation = useMutation({
    mutationFn: validateReport,
    onSuccess: async () => {
      pushToast({
        type: 'success',
        title: 'Rapport valide',
        message: 'Le rapport est pret pour envoi client.',
      });
      await queryClient.invalidateQueries({ queryKey: ['dashboard', 'coordinator'] });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Validation impossible',
        message: error instanceof Error ? error.message : 'Le rapport ne peut pas etre valide.',
      });
    },
  });

  const reminderMutation = useMutation({
    mutationFn: sendReminder,
    onSuccess: async (result) => {
      pushToast({
        type: result.reminder.status === 'queued' ? 'success' : 'warning',
        title: result.reminder.status === 'queued' ? 'Relance preparee' : 'Aucun appareil actif',
        message:
          result.reminder.status === 'queued'
            ? `${result.reminder.pushTokenCount} appareil(s) pret(s) pour ${result.reminder.supervisorName}.`
            : `${result.reminder.supervisorName} n'a pas encore de token push actif.`,
      });
      await queryClient.invalidateQueries({ queryKey: ['dashboard', 'coordinator'] });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Relance impossible',
        message: error instanceof Error ? error.message : 'La relance ne peut pas etre envoyee.',
      });
    },
  });

  const departureMutation = useMutation({
    mutationFn: clockOut,
    onSuccess: async () => {
      pushToast({
        type: 'success',
        title: 'Sortie pointee',
        message: 'La session terrain a ete cloturee.',
      });
      await queryClient.invalidateQueries({ queryKey: ['dashboard', 'coordinator'] });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Pointage sortie impossible',
        message: error instanceof Error ? error.message : 'La sortie ne peut pas etre pointee.',
      });
    },
  });

  if (query.isLoading) {
    return <CoordinatorDashboardLoading />;
  }

  if (query.isError || !query.data) {
    return (
      <EmptyState
        title="Dashboard coordinateur indisponible"
        description="Les donnees temps reel n'ont pas pu etre chargees. Rafraichis la page ou reessaie dans quelques instants."
      />
    );
  }

  const data = query.data;

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">Dashboard coordinateur</p>
        <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Validation des rapports terrain</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Suivi des superviseurs rattaches, validation client et alertes de session en temps reel.
            </p>
          </div>
          <Badge tone="info">Maj {formatTime(data.generatedAt)}</Badge>
        </div>
      </section>

      <FieldSessionBar
        fieldSession={data.fieldSession}
        onClockOut={(siteId) => departureMutation.mutate(siteId)}
        pending={departureMutation.isPending}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.stats.map((stat) => (
          <StatsCard key={stat.label} stat={stat} />
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <PendingReportsPanel
          items={data.pendingValidationReports}
          pendingReportId={validateMutation.variables ?? null}
          validating={validateMutation.isPending}
          onValidate={(reportId) => validateMutation.mutate(reportId)}
        />
        <SupervisorsWithoutReportPanel
          items={data.supervisorsWithoutReport}
          pendingSessionId={reminderMutation.variables ?? null}
          reminding={reminderMutation.isPending}
          onRemind={(clockInRecordId) => reminderMutation.mutate(clockInRecordId)}
        />
      </section>

      <AlertsPanel alerts={data.alerts} />
    </div>
  );
}

async function fetchCoordinatorDashboard() {
  const response = await authFetch('/api/dashboard', { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Dashboard request failed with status ${response.status}`);
  }

  const data = (await response.json()) as CoordinatorDashboardData;

  if (data.role !== 'COORDINATOR') {
    throw new Error('Ce dashboard est reserve aux coordinateurs.');
  }

  return data;
}

async function validateReport(reportId: string) {
  const response = await authFetch(`/api/reports/${reportId}/validate-client`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(await readApiMessage(response, 'Validation refusee.'));
  }

  return undefined;
}

async function sendReminder(clockInRecordId: string) {
  const response = await authFetch('/api/coordinator/reminders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ clockInRecordId }),
  });

  if (!response.ok) {
    throw new Error(await readApiMessage(response, 'Relance refusee.'));
  }

  return (await response.json()) as {
    reminder: {
      supervisorName: string;
      pushTokenCount: number;
      status: 'queued' | 'no_push_token';
    };
  };
}

async function clockOut(siteId: string) {
  const position = await getCurrentPosition();
  const timestampLocal = new Date().toISOString();
  const response = await authFetch(`/api/sites/${siteId}/clock-in`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'DEPARTURE',
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestampLocal,
      comment: 'Sortie rapide depuis dashboard coordinateur',
    }),
  });

  if (!response.ok) {
    throw new Error(await readApiMessage(response, 'Pointage sortie refuse.'));
  }

  return undefined;
}

function FieldSessionBar({
  fieldSession,
  onClockOut,
  pending,
}: Readonly<{
  fieldSession: CoordinatorDashboardData['fieldSession'];
  onClockOut: (siteId: string) => void;
  pending: boolean;
}>) {
  if (!fieldSession) {
    return (
      <section className="rounded-[2rem] border border-dashed border-slate-200 bg-white p-5 text-sm text-slate-600">
        Aucune session terrain ouverte pour le moment.
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-[2rem] border border-emerald-200 bg-emerald-50 p-5 text-emerald-950 shadow-panel md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-sm font-semibold">En session sur {fieldSession.siteName} depuis {formatDuration(fieldSession.durationSeconds)}</p>
        <p className="mt-1 text-sm text-emerald-800">Arrivee pointee a {formatTime(fieldSession.arrivalAt)}</p>
      </div>
      <button
        className="rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending}
        onClick={() => onClockOut(fieldSession.siteId)}
        type="button"
      >
        {pending ? 'Pointage...' : 'Pointer sortie'}
      </button>
    </section>
  );
}

function PendingReportsPanel({
  items,
  pendingReportId,
  validating,
  onValidate,
}: Readonly<{
  items: CoordinatorPendingReportItem[];
  pendingReportId: string | null;
  validating: boolean;
  onValidate: (reportId: string) => void;
}>) {
  return (
    <SectionCard title="Rapports en attente de validation">
      {items.length === 0 ? (
        <CompactEmptyState message="Aucun rapport soumis en attente de validation client." />
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <article key={item.id} className="rounded-3xl border border-slate-200 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-950">{item.supervisorName}</p>
                  <p className="mt-1 text-sm text-slate-500">{item.siteName} - soumis a {formatTime(item.submittedAt)}</p>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{item.excerpt}</p>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-orange-500" style={{ width: `${item.progressPercent}%` }} />
                  </div>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                    Progression {item.progressPercent} %
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link
                    className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    href={`/reports/${item.id}`}
                  >
                    Voir
                  </Link>
                  <button
                    className="rounded-2xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={validating && pendingReportId === item.id}
                    onClick={() => onValidate(item.id)}
                    type="button"
                  >
                    {validating && pendingReportId === item.id ? 'Validation...' : 'Valider pour client'}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function SupervisorsWithoutReportPanel({
  items,
  pendingSessionId,
  reminding,
  onRemind,
}: Readonly<{
  items: CoordinatorSupervisorWithoutReportItem[];
  pendingSessionId: string | null;
  reminding: boolean;
  onRemind: (clockInRecordId: string) => void;
}>) {
  return (
    <SectionCard title="Superviseurs sans rapport">
      {items.length === 0 ? (
        <CompactEmptyState message="Toutes les sessions terminees aujourd'hui ont un rapport soumis." />
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <article key={item.id} className="rounded-3xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-950">{item.supervisorName}</p>
                  <p className="mt-1 text-sm text-slate-500">{item.siteName}</p>
                  <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-400">
                    Fin session {formatDateTime(item.endedAt)}
                  </p>
                </div>
                <Badge tone={item.pushTokenCount > 0 ? 'info' : 'warning'}>
                  {item.pushTokenCount} token(s)
                </Badge>
              </div>
              <button
                className="mt-4 w-full rounded-2xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-700 transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={reminding && pendingSessionId === item.id}
                onClick={() => onRemind(item.id)}
                type="button"
              >
                {reminding && pendingSessionId === item.id ? 'Relance...' : 'Relancer'}
              </button>
            </article>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function AlertsPanel({ alerts }: Readonly<{ alerts: DashboardAlertItem[] }>) {
  return (
    <SectionCard title="Alertes">
      {alerts.length === 0 ? (
        <CompactEmptyState message="Aucune alerte coordinateur pour le moment." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {alerts.map((alert) => (
            <article key={alert.id} className="rounded-3xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={alert.level === 'error' ? 'error' : alert.level === 'warning' ? 'warning' : 'info'}>
                  {alert.badge ?? alert.level}
                </Badge>
                <p className="font-semibold text-slate-950">{alert.title}</p>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">{alert.description}</p>
            </article>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function SectionCard({
  title,
  children,
}: Readonly<{
  title: string;
  children: ReactNode;
}>) {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
      <h2 className="mb-5 text-xl font-semibold text-slate-950">{title}</h2>
      {children}
    </section>
  );
}

function CompactEmptyState({ message }: Readonly<{ message: string }>) {
  return <p className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">{message}</p>;
}

function CoordinatorDashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="h-40 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
      <div className="h-24 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-36 animate-pulse rounded-3xl border border-slate-200 bg-white shadow-panel" />
        ))}
      </section>
      <section className="grid gap-6 xl:grid-cols-2">
        <div className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
        <div className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
      </section>
    </div>
  );
}

function getCurrentPosition(): Promise<GeolocationPosition> {
  if (!navigator.geolocation) {
    return Promise.reject(new Error("La geolocalisation navigateur n'est pas disponible."));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, () => {
      reject(new Error('Autorise la geolocalisation pour pointer la sortie.'));
    });
  });
}

async function readApiMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message ?? fallback;
  } catch {
    return fallback;
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours <= 0) {
    return `${minutes} min`;
  }

  return `${hours}h${String(minutes).padStart(2, '0')}`;
}
