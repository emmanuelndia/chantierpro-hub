'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Role } from '@prisma/client';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import { formatRoleLabel } from '@/lib/role-labels';

type ValidationStatus = 'PENDING' | 'VALIDATED' | 'REFUSED';
type ValidationAction = 'VALIDATE' | 'REFUSE';

type OutOfPlanningValidationItem = {
  id: string;
  resourceName: string;
  matricule: string | null;
  role: Role;
  siteName: string;
  siteAddress: string;
  projectName: string;
  timestampLocal: string;
  distanceMeters: number;
  taskText: string;
  validationStatus: ValidationStatus;
  validationLabel: string;
  decisionNote: string | null;
};

type OutOfPlanningValidationsResponse = {
  items: OutOfPlanningValidationItem[];
  summary: {
    total: number;
    pending: number;
    validated: number;
    refused: number;
  };
};

const statusOptions: { value: ValidationStatus; label: string }[] = [
  { value: 'PENDING', label: 'En attente' },
  { value: 'VALIDATED', label: 'Valides' },
  { value: 'REFUSED', label: 'Refuses' },
];

export function OutOfPlanningValidationsPage({ viewer }: Readonly<{ viewer: { role: Role } }>) {
  const { pushToast } = useToast();
  const [status, setStatus] = useState<ValidationStatus>('PENDING');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const requestPath = `/api/clock-in/out-of-planning-validations?status=${encodeURIComponent(status)}`;

  const validationsQuery = useQuery({
    queryKey: ['out-of-planning-validations', requestPath],
    queryFn: async () => {
      const response = await authFetch(requestPath, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Validations hors planning indisponibles (${response.status}).`);
      }
      return (await response.json()) as OutOfPlanningValidationsResponse;
    },
    placeholderData: (previousData) => previousData,
  });

  const decisionMutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: ValidationAction }) => {
      const response = await authFetch(`/api/clock-in/out-of-planning-validations/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: notes[id] ?? '' }),
      });

      if (!response.ok) {
        const body = (await safeJson(response)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Decision impossible.');
      }

      return response.json() as Promise<{ item: OutOfPlanningValidationItem }>;
    },
    onSuccess: async (_, variables) => {
      setNotes((current) => ({ ...current, [variables.id]: '' }));
      pushToast({ type: 'success', title: variables.action === 'VALIDATE' ? 'Pointage valide' : 'Pointage refuse' });
      await validationsQuery.refetch();
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Validation impossible',
        message: error instanceof Error ? error.message : 'La decision na pas pu etre enregistree.',
      });
    },
  });

  const data = validationsQuery.data;
  const items = useMemo(() => data?.items ?? [], [data?.items]);

  if (validationsQuery.isError) {
    return <EmptyState title="Validations indisponibles" description="Les pointages hors planning ne peuvent pas etre charges pour le moment." />;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">Pointages hors planning</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Validation PM</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Controle les presences creees sans tache planning. La ressource doit etre a moins de 100 m du chantier et declarer les taches effectuees.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="info">{formatRoleLabel(viewer.role)}</Badge>
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              onClick={() => void validationsQuery.refetch()}
              type="button"
            >
              Actualiser
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Total" value={data?.summary.total ?? 0} />
        <Kpi label="En attente" tone="warning" value={data?.summary.pending ?? 0} />
        <Kpi label="Valides" tone="success" value={data?.summary.validated ?? 0} />
        <Kpi label="Refuses" tone="danger" value={data?.summary.refused ?? 0} />
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Filtre</h2>
            <p className="mt-1 text-sm text-slate-500">Affiche les pointages selon leur etat de validation.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {statusOptions.map((option) => (
              <button
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  status === option.value
                    ? 'bg-slate-950 text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
                key={option.value}
                onClick={() => setStatus(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-panel">
        {validationsQuery.isLoading && !data ? (
          <p className="p-8 text-center text-sm text-slate-500">Chargement des validations...</p>
        ) : items.length === 0 ? (
          <div className="p-8">
            <EmptyState title="Aucun pointage" description="Aucun pointage hors planning ne correspond au filtre actif." />
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((item) => (
              <article className="p-5" key={item.id}>
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(240px,0.7fr)_auto] xl:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-slate-950">{item.resourceName}</h3>
                      <StatusBadge status={item.validationStatus} />
                      {item.matricule ? <Badge tone="neutral">{item.matricule}</Badge> : null}
                    </div>
                    <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{formatRoleLabel(item.role)}</p>
                    <div className="mt-4 grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                      <p><span className="font-semibold text-slate-950">Projet :</span> {item.projectName}</p>
                      <p><span className="font-semibold text-slate-950">Chantier :</span> {item.siteName}</p>
                      <p><span className="font-semibold text-slate-950">Entree :</span> {formatDateTime(item.timestampLocal)}</p>
                      <p><span className="font-semibold text-slate-950">Distance :</span> {item.distanceMeters} m</p>
                    </div>
                    <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm font-semibold leading-6 text-slate-700">
                      <span className="font-semibold text-slate-950">Taches declarees :</span> {item.taskText || '-'}
                    </p>
                    {item.decisionNote ? (
                      <p className="mt-2 rounded-2xl bg-blue-50 p-3 text-sm font-semibold leading-6 text-blue-900">
                        <span className="font-semibold">Note PM :</span> {item.decisionNote}
                      </p>
                    ) : null}
                  </div>

                  <label className="block text-sm font-semibold text-slate-700">
                    Note PM optionnelle
                    <textarea
                      className="mt-2 min-h-24 w-full rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white disabled:opacity-60"
                      disabled={item.validationStatus !== 'PENDING' || decisionMutation.isPending}
                      onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                      placeholder="Ex: intervention confirmee, passage non autorise..."
                      value={notes[item.id] ?? ''}
                    />
                  </label>

                  <div className="flex flex-wrap gap-2 xl:flex-col">
                    <button
                      className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                      disabled={item.validationStatus !== 'PENDING' || decisionMutation.isPending}
                      onClick={() => decisionMutation.mutate({ id: item.id, action: 'VALIDATE' })}
                      type="button"
                    >
                      Valider
                    </button>
                    <button
                      className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
                      disabled={item.validationStatus !== 'PENDING' || decisionMutation.isPending}
                      onClick={() => decisionMutation.mutate({ id: item.id, action: 'REFUSE' })}
                      type="button"
                    >
                      Refuser
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, tone = 'neutral', value }: Readonly<{ label: string; tone?: 'neutral' | 'success' | 'warning' | 'danger'; value: number }>) {
  const toneClassName = {
    neutral: 'bg-white text-slate-950',
    success: 'bg-emerald-50 text-emerald-900',
    warning: 'bg-amber-50 text-amber-900',
    danger: 'bg-red-50 text-red-900',
  }[tone];

  return (
    <div className={`rounded-[2rem] border border-slate-200 p-5 shadow-panel ${toneClassName}`}>
      <p className="text-xs font-bold uppercase tracking-[0.16em] opacity-70">{label}</p>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: Readonly<{ status: ValidationStatus }>) {
  if (status === 'VALIDATED') return <Badge tone="success">Valide</Badge>;
  if (status === 'REFUSED') return <Badge tone="error">Refuse</Badge>;
  return <Badge tone="warning">En attente</Badge>;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
