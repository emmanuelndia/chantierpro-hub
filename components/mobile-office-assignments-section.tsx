'use client';

import { useState } from 'react';
import Link from 'next/link';
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

export function useTodayOfficeAssignments(enabled = true) {
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
    enabled,
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
  const [formError, setFormError] = useState<string | null>(null);
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
      const errorMessage = error instanceof Error ? error.message : "L'avancement n'a pas pu etre enregistre.";
      setFormError(errorMessage);
      setMessage(errorMessage);
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
    setFormError(null);
  }

  function submitProgress() {
    if (!progressTarget) return;
    const hasQuantityObjective = hasQuantitativeObjective(progressTarget);
    const trimmedComment = comment.trim();
    const parsedProgress = progress.trim() === '' ? null : Number(progress);
    const parsedQuantity = actualQuantity.trim() === '' ? null : Number(actualQuantity);

    if (blocked && !trimmedComment) {
      setFormError('Ajoutez un commentaire pour signaler un blocage.');
      return;
    }

    if (!hasQuantityObjective && blocked && completed) {
      setFormError('Une tache bloquee ne peut pas etre marquee terminee.');
      return;
    }

    setFormError(null);
    progressMutation.mutate({
      assignment: progressTarget,
      input: {
        ...(hasQuantityObjective ? { actualQuantity: parsedQuantity } : { progress: parsedProgress, completed }),
        comment: trimmedComment || null,
        blocked,
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
          const isFreeMission = assignment.workLocationType === 'FREE_MISSION';
          const status = objectiveStatusConfig[assignment.objectiveStatus];
          const progressValue = Math.max(0, Math.min(100, assignment.actualProgress ?? 0));
          const unit = assignment.targetUnit ?? '';
          const hasQuantityObjective = hasQuantitativeObjective(assignment);
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
                {isFreeMission ? 'Mission libre' : assignment.workLocationType === 'OFFICE' ? 'Bureau' : 'Terrain'}
              </span>
            </div>
            {isFreeMission ? (
              <p className="mt-2 inline-flex rounded-full bg-orange-50 px-2.5 py-1 text-xs font-black text-orange-700">
                Pointage GPS sans chantier fixe
              </p>
            ) : null}
            {assignment.siteType === 'INTERVENTION_ZONE' ? (
              <p className="mt-2 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">
                Zone d&apos;intervention
              </p>
            ) : null}
            {assignment.targetQuantity !== null && assignment.targetQuantity > 0 ? (
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
            {isFreeMission ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Link
                  className="rounded-lg bg-slate-950 px-3 py-2 text-center text-xs font-black text-white"
                  href={`/mobile/clock-in?freeMissionId=${encodeURIComponent(assignment.freeMissionId ?? assignment.id)}`}
                >
                  Pointer
                </Link>
                <Link
                  className="rounded-lg bg-indigo-600 px-3 py-2 text-center text-xs font-black text-white"
                  href={`/mobile/photo?freeMissionId=${encodeURIComponent(assignment.freeMissionId ?? assignment.id)}`}
                >
                  Photo
                </Link>
              </div>
            ) : (
              <button
                className={`mt-3 w-full rounded-lg px-3 py-2 text-xs font-black text-white ${status.buttonClassName}`}
                onClick={() => openProgressModal(assignment)}
                type="button"
              >
                Mettre a jour l&apos;avancement
              </button>
            )}
          </article>
          );
        })}
      </div>
      {message ? <p className="mt-3 rounded-lg bg-white p-3 text-xs font-bold text-indigo-800">{message}</p> : null}
      {progressTarget ? (
        <TaskProgressModal
          actualQuantity={actualQuantity}
          blocked={blocked}
          comment={comment}
          completed={completed}
          error={formError}
          onActualQuantityChange={setActualQuantity}
          onBlockedChange={(value) => {
            setBlocked(value);
            if (value) setCompleted(false);
            setFormError(null);
          }}
          onCancel={() => setProgressTarget(null)}
          onCommentChange={setComment}
          onCompletedChange={(value) => {
            setCompleted(value);
            if (value) setBlocked(false);
            setFormError(null);
          }}
          onProgressChange={setProgress}
          onSubmit={submitProgress}
          pending={progressMutation.isPending}
          progress={progress}
          target={progressTarget}
        />
      ) : null}
    </section>
  );
}

function ObjectiveStatusBadge({ status }: Readonly<{ status: SupervisorMyAssignment['objectiveStatus'] }>) {
  const config = objectiveStatusConfig[status];

  return <span className={`rounded-full px-2.5 py-1 text-xs font-black ${config.badgeClassName}`}>{config.label}</span>;
}

function TaskProgressModal({
  actualQuantity,
  blocked,
  comment,
  completed,
  error,
  onActualQuantityChange,
  onBlockedChange,
  onCancel,
  onCommentChange,
  onCompletedChange,
  onProgressChange,
  onSubmit,
  pending,
  progress,
  target,
}: Readonly<{
  actualQuantity: string;
  blocked: boolean;
  comment: string;
  completed: boolean;
  error: string | null;
  onActualQuantityChange: (value: string) => void;
  onBlockedChange: (value: boolean) => void;
  onCancel: () => void;
  onCommentChange: (value: string) => void;
  onCompletedChange: (value: boolean) => void;
  onProgressChange: (value: string) => void;
  onSubmit: () => void;
  pending: boolean;
  progress: string;
  target: SupervisorMyAssignment;
}>) {
  const hasQuantity = hasQuantitativeObjective(target);
  const preview = hasQuantity ? buildQuantityPreview(target, actualQuantity) : null;
  const previewStatus: SupervisorMyAssignment['objectiveStatus'] = blocked
    ? 'BLOCKED'
    : hasQuantity
      ? preview?.achieved
        ? 'ACHIEVED'
        : preview && preview.progress > 0
          ? 'PARTIAL'
          : 'NOT_STARTED'
      : completed
        ? 'ACHIEVED'
        : target.objectiveStatus;
  const status = blocked
    ? objectiveStatusConfig.BLOCKED
    : preview?.achieved
      ? objectiveStatusConfig.ACHIEVED
      : preview && preview.progress > 0
        ? objectiveStatusConfig.PARTIAL
        : objectiveStatusConfig.NOT_STARTED;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/50 p-3">
      <section className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-4 shadow-xl">
        <div className="rounded-2xl bg-slate-950 p-4 text-white">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-white/55">Avancement</p>
          <h3 className="mt-2 text-lg font-black">{target.action}</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <ObjectiveStatusBadge status={previewStatus} />
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-bold">
              Objectif {hasQuantity ? `${formatQuantity(target.targetQuantity)} ${target.targetUnit ?? ''}` : target.targetProgress !== null ? `${target.targetProgress}%` : 'texte'}
            </span>
          </div>
        </div>

        {hasQuantity ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <label className="block text-sm font-black text-slate-800" htmlFor="actual-quantity">
              Realise cumule
            </label>
            <div className="mt-2 flex overflow-hidden rounded-2xl border border-slate-200 bg-white focus-within:border-indigo-500">
              <input
                className="min-h-14 min-w-0 flex-1 px-4 text-lg font-black text-slate-950 outline-none"
                id="actual-quantity"
                min={0}
                onChange={(event) => onActualQuantityChange(event.currentTarget.value)}
                step="0.01"
                type="number"
                value={actualQuantity}
              />
              <span className="flex min-w-16 items-center justify-center bg-slate-100 px-3 text-sm font-black text-slate-600">
                {target.targetUnit ?? 'unite'}
              </span>
            </div>
            <div className="mt-4 rounded-2xl bg-white p-3">
              <div className="flex items-center justify-between gap-3 text-xs font-black">
                <span className={status.textClassName}>{preview?.label ?? 'Saisissez le realise'}</span>
                <span className="text-slate-700">{preview?.progress ?? 0}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className={`h-full rounded-full ${status.barClassName}`} style={{ width: `${preview?.progress ?? 0}%` }} />
              </div>
              <p className="mt-2 text-xs font-semibold text-slate-500">
                Dernier declare : {formatQuantity(target.actualQuantity ?? 0)} / {formatQuantity(target.targetQuantity)} {target.targetUnit ?? ''}
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <label className="block text-sm font-black text-slate-800" htmlFor="actual-progress">
              Progression realisee %
            </label>
            <input
              className="mt-2 min-h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-lg font-black text-slate-950 outline-none focus:border-indigo-500"
              id="actual-progress"
              max={100}
              min={0}
              onChange={(event) => onProgressChange(event.currentTarget.value)}
              type="number"
              value={progress}
            />
            <ToggleButton
              active={completed}
              className="mt-3"
              label="Marquer comme termine"
              onClick={() => onCompletedChange(!completed)}
              tone="success"
            />
          </div>
        )}

        <div className="mt-4 rounded-2xl border border-slate-200 p-4">
          <ToggleButton
            active={blocked}
            label="Signaler un blocage"
            onClick={() => onBlockedChange(!blocked)}
            tone="danger"
          />
          <label className="mt-3 block text-sm font-black text-slate-800" htmlFor="progress-comment">
            Commentaire {blocked ? '(obligatoire)' : '(facultatif)'}
          </label>
          <textarea
            className="mt-2 min-h-24 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold outline-none focus:border-indigo-500"
            id="progress-comment"
            onChange={(event) => onCommentChange(event.currentTarget.value)}
            value={comment}
          />
        </div>

        {error ? <p className="mt-3 rounded-2xl bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p> : null}

        <div className="mt-5 grid grid-cols-2 gap-3">
          <button className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold" onClick={onCancel} type="button">
            Annuler
          </button>
          <button
            className="rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-black text-white disabled:opacity-60"
            disabled={pending}
            onClick={onSubmit}
            type="button"
          >
            Enregistrer
          </button>
        </div>
      </section>
    </div>
  );
}

function ToggleButton({
  active,
  className = '',
  label,
  onClick,
  tone,
}: Readonly<{
  active: boolean;
  className?: string;
  label: string;
  onClick: () => void;
  tone: 'danger' | 'success';
}>) {
  const activeClassName = tone === 'danger' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700';

  return (
    <button
      className={`flex min-h-12 w-full items-center justify-between rounded-2xl border px-4 text-sm font-black ${
        active ? activeClassName : 'border-slate-200 bg-white text-slate-600'
      } ${className}`}
      onClick={onClick}
      type="button"
    >
      {label}
      <span className={`h-6 w-11 rounded-full p-1 transition ${active ? 'bg-current' : 'bg-slate-200'}`}>
        <span className={`block h-4 w-4 rounded-full bg-white transition ${active ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  );
}

function hasQuantitativeObjective(assignment: SupervisorMyAssignment) {
  return assignment.targetQuantity !== null && assignment.targetQuantity > 0;
}

function buildQuantityPreview(assignment: SupervisorMyAssignment, value: string) {
  const target = assignment.targetQuantity ?? 0;
  const actual = value.trim() === '' ? 0 : Number(value);
  const safeActual = Number.isFinite(actual) ? Math.max(0, actual) : 0;
  const rawProgress = target > 0 ? Math.round((safeActual / target) * 100) : 0;
  const progress = Math.max(0, Math.min(100, rawProgress));
  const remaining = Math.max(0, target - safeActual);
  const unit = assignment.targetUnit ?? '';

  if (safeActual > target) {
    return {
      achieved: true,
      label: `Objectif depasse de ${formatQuantity(safeActual - target)} ${unit}`.trim(),
      progress,
    };
  }

  if (safeActual >= target) {
    return {
      achieved: true,
      label: 'Objectif atteint',
      progress,
    };
  }

  return {
    achieved: false,
    label: safeActual > 0 ? `Reste ${formatQuantity(remaining)} ${unit}`.trim() : `Reste ${formatQuantity(target)} ${unit}`.trim(),
    progress,
  };
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
