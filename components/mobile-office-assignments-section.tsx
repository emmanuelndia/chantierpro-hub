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
    officeAssignments,
    usingOfflineAssignments,
  };
}

export function MobileOfficeAssignmentsSection({
  assignments,
  usingOfflineData,
}: Readonly<{
  assignments: SupervisorMyAssignment[];
  usingOfflineData: boolean;
}>) {
  const queryClient = useQueryClient();
  const [progressTarget, setProgressTarget] = useState<SupervisorMyAssignment | null>(null);
  const [progress, setProgress] = useState('');
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
    setComment(assignment.latestProgressUpdate?.comment ?? '');
    setBlocked(assignment.latestProgressUpdate?.blocked ?? false);
    setCompleted(assignment.latestProgressUpdate?.completed ?? false);
    setMessage(null);
  }

  function submitProgress() {
    if (!progressTarget) return;
    const parsedProgress = progress.trim() === '' ? null : Number(progress);
    progressMutation.mutate({
      assignment: progressTarget,
      input: {
        progress: parsedProgress,
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
            Taches bureau du jour
          </h2>
          <p className="mt-1 text-sm font-semibold text-indigo-900">
            Ces taches ne demandent pas de pointage chantier.
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
        {assignments.map((assignment) => (
          <article key={assignment.id} className="rounded-lg bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-950">{assignment.siteName}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">{assignment.siteAddress}</p>
                <p className="mt-2 text-sm leading-5 text-slate-700">{assignment.action}</p>
              </div>
              <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                Bureau
              </span>
            </div>
            {assignment.targetProgress !== null ? (
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
            </div>
            <button
              className="mt-3 w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white"
              onClick={() => openProgressModal(assignment)}
              type="button"
            >
              Mettre a jour l&apos;avancement
            </button>
          </article>
        ))}
      </div>
      {message ? <p className="mt-3 rounded-lg bg-white p-3 text-xs font-bold text-indigo-800">{message}</p> : null}
      {progressTarget ? (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 p-3">
          <section className="w-full rounded-t-2xl bg-white p-4 shadow-xl">
            <h3 className="text-base font-black text-slate-950">Avancement</h3>
            <p className="mt-1 text-sm text-slate-600">{progressTarget.action}</p>
            <label className="mt-4 block text-sm font-bold text-slate-700">
              Progression realisee %
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
  const config = {
    NOT_STARTED: 'Non demarre',
    PARTIAL: 'Partiel',
    ACHIEVED: 'Atteint',
    BLOCKED: 'Bloque',
  } satisfies Record<SupervisorMyAssignment['objectiveStatus'], string>;

  return <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">{config[status]}</span>;
}
