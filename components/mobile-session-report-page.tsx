'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Camera, CheckCircle2, Clock3, FileUp, MapPin, Send, Target, X } from 'lucide-react';
import { authFetch } from '@/lib/auth/client-session';
import {
  createOfflineId,
  enqueueOfflineSessionReport,
  getMobileOfflineCache,
  setMobileOfflineCache,
} from '@/lib/mobile-offline-db';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type {
  ReportSubmissionResponse,
  SessionReportData,
  SubmitReportRequest,
} from '@/types/mobile-session-report';
import '@/styles/slider.css';

type MobileSessionReportPageProps = Readonly<{
  user: WebSessionUser;
}>;

export function MobileSessionReportPage({ user: _user }: MobileSessionReportPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [content, setContent] = useState('');
  const [progressPercentage, setProgressPercentage] = useState(50);
  const [blockageNote, setBlockageNote] = useState('');
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [skipConfirmOpen, setSkipConfirmOpen] = useState(false);

  const sessionId = searchParams.get('sessionId');

  const sessionQuery = useQuery({
    queryKey: ['mobile-session-report', sessionId],
    queryFn: async () => {
      if (!sessionId) {
        throw new Error('Session ID required');
      }

      const response = await authFetch(`/api/mobile/session-report/${sessionId}`);

      if (!response.ok) {
        const cached = await getMobileOfflineCache<SessionReportData>(`session-report-${sessionId}`);
        if (cached) {
          return cached.payload;
        }
        throw new Error(`Session report request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as SessionReportData;
      await setMobileOfflineCache(`session-report-${sessionId}`, payload, 60 * 60 * 1000);
      return payload;
    },
    enabled: Boolean(sessionId),
    refetchInterval: 30_000,
    staleTime: 30_000,
  });

  const submitMutation = useMutation({
    mutationFn: async ({ data, file }: { data: SubmitReportRequest; file: File | null }) => {
      if (file && typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error('Connectez-vous pour envoyer un fichier. Le texte seul reste disponible hors ligne.');
      }

      try {
        const response = file
          ? await authFetch('/api/mobile/session-report', {
              method: 'POST',
              body: buildReportFormData(data, file),
            })
          : await authFetch('/api/mobile/session-report', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(data),
            });

        if (!response.ok) {
          const errorData = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
          throw new Error(errorData.error ?? errorData.message ?? `Erreur ${response.status}: échec de la soumission du rapport`);
        }

        return (await response.json()) as ReportSubmissionResponse;
      } catch (error) {
        console.error('Report submission error:', error);

        if (file) {
          throw error;
        }

        const clientId = createOfflineId();
        await enqueueOfflineSessionReport({
          clientId,
          clockInRecordId: data.clockInRecordId,
          content: data.content,
          progressPercentage: data.progressPercentage,
          ...(data.blockageNote !== undefined ? { blockageNote: data.blockageNote } : {}),
          ...(data.assignmentId !== undefined ? { assignmentId: data.assignmentId } : {}),
          timestampLocal: new Date().toISOString(),
        });

        return {
          success: true,
          reportId: clientId,
          message: 'Rapport sauvegardé hors ligne',
          isOffline: true,
        };
      }
    },
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: ['mobile-session-report', sessionId] });
      void queryClient.invalidateQueries({ queryKey: ['mobile-session-report-pending'] });
      void queryClient.invalidateQueries({ queryKey: ['mobile-history'] });

      if (response.isOffline && 'serviceWorker' in navigator && 'PushManager' in window) {
        console.log('Rapport sauvegardé hors ligne');
      }

      router.push('/mobile/home');
    },
  });

  const data = sessionQuery.data;
  const loading = sessionQuery.isLoading;
  const canSubmit = Boolean(content.trim() || reportFile);

  useEffect(() => {
    if (!data?.assignment) return;

    if (typeof data.assignment.actualProgress === 'number') {
      setProgressPercentage(data.assignment.actualProgress);
    } else if (typeof data.assignment.targetProgress === 'number') {
      setProgressPercentage(data.assignment.targetProgress);
    }

    if (data.assignment.latestProgressComment && !content.trim()) {
      setContent(data.assignment.latestProgressComment);
    }

    if (data.assignment.latestProgressBlocked && data.assignment.latestProgressComment && !blockageNote.trim()) {
      setBlockageNote(data.assignment.latestProgressComment);
    }
    // Prefill only when the session payload changes; user edits stay local afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.assignment?.id]);

  const handleSubmit = () => {
    if (!data || !sessionId || !canSubmit) return;

    const reportData: SubmitReportRequest = {
      clockInRecordId: data.session.clockInRecordId,
      content: content.trim(),
      progressPercentage,
      blockageNote: blockageNote.trim() || undefined,
      assignmentId: data.assignment?.id,
    };

    submitMutation.mutate({ data: reportData, file: reportFile });
  };

  const handleSkip = () => {
    setSkipConfirmOpen(true);
  };

  const confirmSkip = () => {
    setSkipConfirmOpen(false);
    router.push('/mobile/home');
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}min`;
    }
    return `${minutes}min`;
  };

  const formatDateTime = (dateString: string) =>
    new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(dateString));

  if (loading) {
    return <ReportLoadingState />;
  }

  if (!sessionId || sessionQuery.isError || !data) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
        Impossible de charger les données de la session. Veuillez réessayer.
      </div>
    );
  }

  if (data.hasExistingReport) {
    return (
      <div className="space-y-4">
        <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">Rapport déjà soumis</p>
          <h2 className="mt-2 text-xl font-black text-emerald-950">Cette session a déjà un rapport</h2>
          <p className="mt-2 text-sm leading-6 text-emerald-900">
            Le rapport n&apos;est plus modifiable depuis l&apos;application terrain.
          </p>
        </section>

        <button
          className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-primary px-4 text-sm font-black text-white shadow-lg shadow-orange-200"
          onClick={() => router.push('/mobile/history')}
          type="button"
        >
          Voir dans l&apos;historique
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-28">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-panel">
        <div className="border-b border-slate-100 bg-slate-950 p-5 text-white">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-orange-300">Rapport de session</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight">{data.session.siteName}</h1>
          <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-300">
            <MapPin className="h-4 w-4 text-orange-300" />
            {data.session.siteAddress}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4">
          <SessionMetric icon={<Clock3 className="h-4 w-4" />} label="Arrivée" value={formatDateTime(data.session.arrivalAt)} />
          <SessionMetric icon={<Clock3 className="h-4 w-4" />} label="Départ" value={formatDateTime(data.session.departureAt)} />
          <SessionMetric label="Durée" value={formatDuration(data.session.effectiveDurationSeconds)} />
          <SessionMetric icon={<Camera className="h-4 w-4" />} label="Photos" value={String(data.session.photoCount)} />
        </div>
      </section>

      {data.assignment ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-panel">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-primary">
              <Target className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Tâche du jour</p>
              <h2 className="mt-1 text-lg font-black leading-tight text-slate-950">{data.assignment.action}</h2>
              {data.assignment.objectiveText ? (
                <p className="mt-2 text-sm leading-6 text-slate-600">{data.assignment.objectiveText}</p>
              ) : null}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <MiniInfo label="Cible" value={data.assignment.targetProgress !== undefined ? `${data.assignment.targetProgress}%` : 'Libre'} />
            <MiniInfo
              label="Dernier avancement"
              value={data.assignment.actualProgress !== null && data.assignment.actualProgress !== undefined ? `${data.assignment.actualProgress}%` : 'Non déclaré'}
            />
          </div>
          {data.assignment.latestProgressBlocked ? (
            <div className="mt-4 rounded-2xl border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-800">
              Blocage signalé sur cette tâche.
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-panel">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Compte rendu</p>
            <h2 className="mt-1 text-lg font-black text-slate-950">Ce qui a été réalisé</h2>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-slate-500">
            Optionnel si fichier
          </span>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Décrivez les travaux réalisés, l'avancement, les difficultés rencontrées..."
          className="mt-4 h-36 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 placeholder-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          rows={6}
        />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-panel">
        <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Pièce jointe</p>
        <h2 className="mt-1 text-lg font-black text-slate-950">Ajouter un fichier</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          PDF, Excel, Word ou image. Les fichiers demandent une connexion.
        </p>
        <label className="mt-4 flex min-h-20 cursor-pointer items-center justify-center gap-3 rounded-2xl border border-dashed border-orange-300 bg-orange-50 px-4 text-sm font-black text-primary">
          <FileUp className="h-5 w-5" />
          {reportFile ? 'Remplacer le fichier' : 'Choisir un fichier'}
          <input
            accept=".pdf,.xlsx,.xls,.docx,.png,.jpg,.jpeg"
            className="sr-only"
            onChange={(event) => setReportFile(event.target.files?.[0] ?? null)}
            type="file"
          />
        </label>
        {reportFile ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
            <span className="min-w-0 truncate text-sm font-bold text-slate-700">{reportFile.name}</span>
            <button
              aria-label="Retirer le fichier"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm"
              onClick={() => setReportFile(null)}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-panel">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Progression</p>
            <h2 className="mt-1 text-lg font-black text-slate-950">Avancement réalisé</h2>
          </div>
          <span className="text-3xl font-black text-primary">{progressPercentage}%</span>
        </div>
        <div className="mt-5 space-y-4">
          <input
            type="range"
            min="0"
            max="100"
            value={progressPercentage}
            onChange={(e) => setProgressPercentage(parseInt(e.target.value))}
            className="slider h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200"
          />
          <div className="flex justify-between text-xs font-bold text-slate-400">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min="0"
              max="100"
              value={progressPercentage}
              onChange={(e) => setProgressPercentage(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
              className="h-12 w-24 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-center text-sm font-black text-slate-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <span className="text-sm font-bold text-slate-500">% réalisé aujourd&apos;hui</span>
          </div>
          {data.assignment?.targetProgress !== undefined ? (
            <p className="rounded-2xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
              Cible planning : {data.assignment.targetProgress}%
            </p>
          ) : null}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-panel">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-orange-50 text-primary">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Blocage</p>
            <h2 className="text-lg font-black text-slate-950">Remarque optionnelle</h2>
          </div>
        </div>
        <input
          type="text"
          value={blockageNote}
          onChange={(e) => setBlockageNote(e.target.value)}
          placeholder="Ex : accès coupé, matériel manquant..."
          className="mt-4 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-700 placeholder-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </section>

      {submitMutation.data?.isOffline ? (
        <section className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          Rapport sauvegardé hors ligne. Il sera synchronisé automatiquement lorsque vous serez connecté.
        </section>
      ) : null}

      {submitMutation.isError ? (
        <section className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          {submitMutation.error instanceof Error ? submitMutation.error.message : "Le rapport n'a pas pu être soumis."}
        </section>
      ) : null}

      <section className="sticky bottom-3 z-10 space-y-3 rounded-3xl border border-slate-200 bg-white/95 p-3 shadow-2xl backdrop-blur">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || submitMutation.isPending}
          className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 text-center text-base font-black text-white shadow-lg shadow-orange-200 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-5 w-5" />
          {submitMutation.isPending ? 'Soumission...' : 'Soumettre le rapport'}
        </button>

        <button
          onClick={handleSkip}
          disabled={submitMutation.isPending}
          className="flex min-h-12 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-center text-sm font-black text-slate-700 transition active:scale-[0.98] disabled:opacity-50"
        >
          Passer
        </button>
      </section>

      <SkipReportDialog
        open={skipConfirmOpen}
        onCancel={() => setSkipConfirmOpen(false)}
        onConfirm={confirmSkip}
      />
    </div>
  );
}

function SkipReportDialog({
  onCancel,
  onConfirm,
  open,
}: Readonly<{
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
}>) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 px-4 pb-4 backdrop-blur-sm">
      <section
        aria-modal="true"
        className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        role="dialog"
      >
        <div className="border-b border-slate-100 p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-primary">
              <Clock3 className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Rapport plus tard</p>
              <h2 className="mt-1 text-xl font-black leading-tight text-slate-950">Passer le rapport maintenant ?</h2>
            </div>
            <button
              aria-label="Fermer"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"
              onClick={onCancel}
              type="button"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-600">
            Vous pourrez encore soumettre ce rapport plus tard depuis l&apos;historique. Votre session restera visible
            comme une session terminee sans rapport jusqu&apos;a sa soumission.
          </p>
        </div>

        <div className="space-y-3 p-4">
          <button
            className="flex min-h-14 w-full items-center justify-center rounded-2xl bg-primary px-4 text-sm font-black text-white shadow-lg shadow-orange-200 transition active:scale-[0.98]"
            onClick={onConfirm}
            type="button"
          >
            Oui, je ferai le rapport plus tard
          </button>
          <button
            className="flex min-h-12 w-full items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition active:scale-[0.98]"
            onClick={onCancel}
            type="button"
          >
            Continuer le rapport
          </button>
        </div>
      </section>
    </div>
  );
}

function SessionMetric({
  icon,
  label,
  value,
}: Readonly<{
  icon?: ReactNode;
  label: string;
  value: string;
}>) {
  return (
    <div className="min-h-20 rounded-2xl bg-slate-50 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">
        {icon}
        {label}
      </p>
      <p className="mt-2 break-words text-sm font-black text-slate-950">{value}</p>
    </div>
  );
}

function MiniInfo({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <p className="text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-1 break-words text-sm font-black text-slate-950">{value}</p>
    </div>
  );
}

function buildReportFormData(data: SubmitReportRequest, file: File) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('clockInRecordId', data.clockInRecordId);
  formData.append('content', data.content);
  formData.append('progressPercentage', String(data.progressPercentage));
  if (data.blockageNote) formData.append('blockageNote', data.blockageNote);
  if (data.assignmentId) formData.append('assignmentId', data.assignmentId);
  return formData;
}

function ReportLoadingState() {
  return (
    <div className="space-y-5">
      <div className="h-40 animate-pulse rounded-3xl bg-slate-100" />
      <div className="h-40 animate-pulse rounded-3xl bg-slate-100" />
      <div className="h-32 animate-pulse rounded-3xl bg-slate-100" />
    </div>
  );
}
