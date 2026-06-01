'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import {
  createOfflineId,
  enqueueOfflineTaskUpdate,
  getMobileOfflineCache,
  setMobileOfflineCache,
} from '@/lib/mobile-offline-db';
import type {
  CreateTaskProgressUpdateRequest,
  SupervisorMyAssignment,
  SupervisorMyAssignmentsResponse,
  TaskProgressUpdateResponse,
} from '@/types/mobile-planning';

export function useTodayOfficeAssignments() {
  const [usingOfflineAssignments, setUsingOfflineAssignments] = useState(false);

  const assignmentsQuery = useQuery({
    queryKey: ['mobile-my-assignments-today'],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const cacheKey = `mobile-planning-my-assignments-${today}`;

      try {
        const response = await authFetch(`/api/mobile/planning/my-assignments?date=${today}`);

        if (!response.ok) {
          throw new Error(`My assignments request failed with status ${response.status}`);
        }

        const payload = (await response.json()) as SupervisorMyAssignmentsResponse;
        setUsingOfflineAssignments(false);
        await setMobileOfflineCache(cacheKey, payload, 24 * 60 * 60 * 1000);
        return payload;
      } catch {
        const cached = await getMobileOfflineCache<SupervisorMyAssignmentsResponse>(cacheKey);

        if (cached) {
          setUsingOfflineAssignments(true);
          return cached.payload;
        }

        throw new Error('My assignments request failed');
      }
    },
    refetchInterval: 60_000,
    staleTime: 300_000,
  });

  const officeAssignments =
    assignmentsQuery.data?.assignments.filter((assignment) => assignment.workLocationType === 'OFFICE') ?? [];

  return {
    assignments: assignmentsQuery.data?.assignments ?? [],
    officeAssignments,
    usingOfflineAssignments,
  };
}

export function MobileOfficeAssignmentsSection({
  assignments,
  usingOfflineData,
  title = 'Taches bureau du jour',
  description = 'Ces taches ne demandent pas de pointage chantier.',
}: Readonly<{
  assignments: SupervisorMyAssignment[];
  usingOfflineData: boolean;
  title?: string;
  description?: string;
}>) {
  const queryClient = useQueryClient();
  const [progressTarget, setProgressTarget] = useState<SupervisorMyAssignment | null>(null);
  const [progress, setProgress] = useState('');
  const [actualQuantity, setActualQuantity] = useState('');
  const [comment, setComment] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const progressMutation = useMutation({
    mutationFn: async ({ assignment, input }: { assignment: SupervisorMyAssignment; input: CreateTaskProgressUpdateRequest }) => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await enqueueOfflineTaskUpdate({
          id: createOfflineId(),
          assignmentId: assignment.id,
          ...(input.progress !== undefined ? { progress: input.progress } : {}),
          ...(input.actualQuantity !== undefined ? { actualQuantity: input.actualQuantity } : {}),
          ...(input.comment !== undefined ? { comment: input.comment } : {}),
          ...(input.blocked !== undefined ? { blocked: input.blocked } : {}),
          ...(input.completed !== undefined ? { completed: input.completed } : {}),
          timestampLocal: new Date().toISOString(),
        });
        return { offline: true };
      }

      const response = await authFetch(`/api/mobile/planning/assignment/${assignment.id}/progress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(payload.message ?? "L'avancement n'a pas pu etre enregistre.");
      }

      return (await response.json()) as TaskProgressUpdateResponse;
    },
    onSuccess: async (result) => {
      setMessage('offline' in result ? 'Avancement stocke hors ligne.' : 'Avancement enregistre.');
      setProgressTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['mobile-my-assignments-today'] });
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "L'avancement n'a pas pu etre enregistre.");
    },
  });

  if (assignments.length === 0) {
    return null;
  }

  function openProgressModal(assignment: SupervisorMyAssignment) {
    setProgressTarget(assignment);
    setProgress(assignment.actualProgress === null ? '' : String(assignment.actualProgress));
    setActualQuantity(assignment.actualQuantity === null ? '' : String(assignment.actualQuantity));
    setComment(assignment.latestProgressUpdate?.comment ?? '');
    setBlocked(assignment.latestProgressUpdate?.blocked ?? false);
    setCompleted(assignment.latestProgressUpdate?.completed ?? false);
    setMessage(null);
  }

  function submitProgress() {
    if (!progressTarget) return;
    const parsedProgress = progress.trim() === '' ? null : Number(progress);
    const parsedQuantity = actualQuantity.trim() === '' ? null : Number(actualQuantity);
    progressMutation.mutate({
      assignment: progressTarget,
      input: {
        progress: parsedProgress,
        actualQuantity: parsedQuantity,
        comment: comment.trim() || null,
        blocked,
        completed,
      },
    });
  }

  return (
    <section className="rounded-lg border border-indigo-100 bg-indigo-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-indigo-700">
            {title}
          </h2>
          <p className="mt-1 text-sm font-semibold text-indigo-900">
            {description}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-bold text-indigo-700">
          {assignments.length}
        </span>
      </div>

      {usingOfflineData ? (
        <p className="mt-3 rounded-lg bg-white/80 p-3 text-xs font-semibold text-indigo-900">
          Donnees hors ligne. Les taches preparees du jour sont affichees.
        </p>
      ) : null}

      <div className="mt-4 space-y-3">
        {assignments.map((assignment) => {
          const status = objectiveStatusConfig[assignment.objectiveStatus];
          const progressValue = Math.max(0, Math.min(100, assignment.actualProgress ?? 0));
          const unit = assignment.targetUnit ?? '';
          const hasQuantityObjective = assignment.targetQuantity !== null;
          const remainingLabel =
            hasQuantityObjective && assignment.remainingQuantity !== null
              ? assignment.remainingQuantity <= 0
                ? 'Objectif atteint'
                : `Reste ${formatQuantity(assignment.remainingQuantity)} ${unit}`.trim()
              : null;

          return (
          <article key={assignment.id} className={`rounded-lg border p-3 shadow-sm ${status.cardClassName}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-950">{assignment.siteName}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">{assignment.siteAddress}</p>
                <p className="mt-2 text-sm leading-5 text-slate-700">{assignment.action}</p>
              </div>
              <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                {assignment.workLocationType === 'OFFICE' ? 'Bureau' : 'Terrain'}
              </span>
            </div>
            {assignment.targetQuantity !== null ? (
              <p className="mt-2 text-xs font-bold text-indigo-700">
                Objectif {formatQuantity(assignment.targetQuantity)} {assignment.targetUnit ?? ''}
              </p>
            ) : assignment.targetProgress !== null ? (
              <p className="mt-2 text-xs font-bold text-indigo-700">Objectif {assignment.targetProgress}%</p>
            ) : null}
            {assignment.objectiveText ? (
              <p className="mt-2 text-xs font-semibold text-slate-600">{assignment.objectiveText}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ObjectiveStatusBadge status={assignment.objectiveStatus} />
              {assignment.actualProgress !== null ? (
                <span className="text-xs font-bold text-slate-600">Reel {assignment.actualProgress}%</span>
              ) : null}
              {assignment.targetQuantity !== null && assignment.actualQuantity !== null ? (
                <span className="text-xs font-bold text-slate-600">
                  {formatQuantity(assignment.actualQuantity)} / {formatQuantity(assignment.targetQuantity)} {assignment.targetUnit ?? ''}
                </span>
              ) : null}
            </div>
            <div className="mt-3 rounded-lg bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-3 text-xs font-black">
                <span className={status.textClassName}>{status.label}</span>
                <span className="text-slate-600">{progressValue}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className={`h-full rounded-full transition-all ${status.barClassName}`} style={{ width: `${progressValue}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-slate-600">
                {hasQuantityObjective ? (
                  <span>
                    Realise {formatQuantity(assignment.actualQuantity ?? 0)} / {formatQuantity(assignment.targetQuantity)} {unit}
                  </span>
                ) : assignment.actualProgress !== null ? (
                  <span>Progression {assignment.actualProgress}%</span>
                ) : (
                  <span>Aucun avancement declare</span>
                )}
                {remainingLabel ? <span className={status.textClassName}>{remainingLabel}</span> : null}
              </div>
            </div>
            <button
              className={`mt-3 w-full rounded-lg px-3 py-2 text-xs font-black text-white ${status.buttonClassName}`}
              onClick={() => openProgressModal(assignment)}
              type="button"
            >
              Mettre a jour l&apos;avancement
            </button>
          </article>
          );
        })}
      </div>
      {message ? <p className="mt-3 rounded-lg bg-white p-3 text-xs font-bold text-indigo-800">{message}</p> : null}
      {progressTarget ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 p-3">
          <section className="w-full rounded-t-2xl bg-white p-4 shadow-xl">
            <h3 className="text-base font-black text-slate-950">Avancement</h3>
            <p className="mt-1 text-sm text-slate-600">{progressTarget.action}</p>
            {progressTarget.targetQuantity !== null ? (
              <label className="mt-4 block text-sm font-bold text-slate-700">
                Realise cumule {progressTarget.targetUnit ? `(${progressTarget.targetUnit})` : ''}
                <input
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-3 text-sm"
                  min={0}
                  onChange={(event) => setActualQuantity(event.currentTarget.value)}
                  step="0.01"
                  type="number"
                  value={actualQuantity}
                />
                <span className="mt-2 block text-xs font-semibold text-slate-500">
                  Objectif : {formatQuantity(progressTarget.targetQuantity)} {progressTarget.targetUnit ?? ''}
                </span>
              </label>
            ) : null}
            <label className="mt-4 block text-sm font-bold text-slate-700">
              Progression realisee % {progressTarget.targetQuantity !== null ? '(optionnel)' : ''}
              <input
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-3 text-sm"
                max={100}
                min={0}
                onChange={(event) => setProgress(event.currentTarget.value)}
                type="number"
                value={progress}
              />
            </label>
            <label className="mt-3 block text-sm font-bold text-slate-700">
              Commentaire
              <textarea
                className="mt-2 min-h-24 w-full rounded-lg border border-slate-200 px-3 py-3 text-sm"
                onChange={(event) => setComment(event.currentTarget.value)}
                value={comment}
              />
            </label>
            <label className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-700">
              <input checked={blocked} onChange={(event) => setBlocked(event.currentTarget.checked)} type="checkbox" />
              Blocage
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm font-bold text-slate-700">
              <input checked={completed} onChange={(event) => setCompleted(event.currentTarget.checked)} type="checkbox" />
              Tache terminee
            </label>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button className="rounded-lg border border-slate-200 px-4 py-3 text-sm font-bold" onClick={() => setProgressTarget(null)} type="button">
                Annuler
              </button>
              <button
                className="rounded-lg bg-indigo-600 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
                disabled={progressMutation.isPending}
                onClick={submitProgress}
                type="button"
              >
                Enregistrer
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function ObjectiveStatusBadge({ status }: Readonly<{ status: SupervisorMyAssignment['objectiveStatus'] }>) {
  const config = objectiveStatusConfig[status];

  return <span className={`rounded-full px-2.5 py-1 text-xs font-black ${config.badgeClassName}`}>{config.label}</span>;
}

const objectiveStatusConfig = {
  NOT_STARTED: {
    label: 'Non demarre',
    badgeClassName: 'bg-slate-100 text-slate-700',
    barClassName: 'bg-slate-400',
    buttonClassName: 'bg-indigo-600',
    cardClassName: 'border-slate-100 bg-white',
    textClassName: 'text-slate-700',
  },
  PARTIAL: {
    label: 'Partiel',
    badgeClassName: 'bg-amber-100 text-amber-800',
    barClassName: 'bg-amber-500',
    buttonClassName: 'bg-amber-600',
    cardClassName: 'border-amber-100 bg-amber-50/40',
    textClassName: 'text-amber-800',
  },
  ACHIEVED: {
    label: 'Atteint',
    badgeClassName: 'bg-emerald-100 text-emerald-800',
    barClassName: 'bg-emerald-500',
    buttonClassName: 'bg-emerald-600',
    cardClassName: 'border-emerald-100 bg-emerald-50/60',
    textClassName: 'text-emerald-800',
  },
  BLOCKED: {
    label: 'Bloque',
    badgeClassName: 'bg-rose-100 text-rose-800',
    barClassName: 'bg-rose-500',
    buttonClassName: 'bg-rose-600',
    cardClassName: 'border-rose-100 bg-rose-50/60',
    textClassName: 'text-rose-800',
  },
} satisfies Record<
  SupervisorMyAssignment['objectiveStatus'],
  {
    label: string;
    badgeClassName: string;
    barClassName: string;
    buttonClassName: string;
    cardClassName: string;
    textClassName: string;
  }
>;

function formatQuantity(value: number | null) {
  if (value === null) return null;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
