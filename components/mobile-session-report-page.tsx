'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import {
  createOfflineId,
  enqueueOfflineSessionReport,
  getMobileOfflineCache,
  setMobileOfflineCache,
} from '@/lib/mobile-offline-db';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type {
  SubmitReportRequest,
  ReportSubmissionResponse,
  SessionReportData,
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

  // Récupérer l'ID de session depuis les paramètres URL
  const sessionId = searchParams.get('sessionId');

  // Query pour les données de la session
  const sessionQuery = useQuery({
    queryKey: ['mobile-session-report', sessionId],
    queryFn: async () => {
      if (!sessionId) {
        throw new Error('Session ID required');
      }

      const response = await authFetch(`/api/mobile/session-report/${sessionId}`);

      if (!response.ok) {
        // Essayer de récupérer depuis le cache offline
        const cached = await getMobileOfflineCache<SessionReportData>(`session-report-${sessionId}`);
        if (cached) {
          return cached.payload;
        }
        throw new Error(`Session report request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as SessionReportData;
      await setMobileOfflineCache(`session-report-${sessionId}`, payload, 60 * 60 * 1000); // 1 heure
      return payload;
    },
    enabled: !!sessionId,
    refetchInterval: 30_000,
    staleTime: 30_000,
  });

  // Mutation pour soumettre le rapport
  const submitMutation = useMutation({
    mutationFn: async ({ data, file }: { data: SubmitReportRequest; file: File | null }) => {
      if (file && typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error('Connectez-vous pour envoyer un fichier. Le texte seul reste disponible hors ligne.');
      }

      // Essayer de soumettre en ligne
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
          throw new Error(errorData.error ?? errorData.message ?? `Erreur ${response.status}: Échec de la soumission du rapport`);
        }

        return (await response.json()) as ReportSubmissionResponse;
      } catch (error) {
        console.error('Report submission error:', error);

        if (file) {
          throw error;
        }
        
        // Si échec, sauvegarder en offline
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
      
      if (response.isOffline) {
        // Notification offline
        if ('serviceWorker' in navigator && 'PushManager' in window) {
          // Afficher notification offline
          console.log('Rapport sauvegardé hors ligne');
        }
      }

      // Rediriger vers l'accueil
      router.push('/mobile/home');
    },
  });

  const data = sessionQuery.data;
  const loading = sessionQuery.isLoading;

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
    if (!data || !sessionId) return;

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
    if (confirm("Vous pourrez encore soumettre ce rapport plus tard depuis l'historique. Passer maintenant ?")) {
      router.push('/mobile/home');
    }
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}min`;
    }
    return `${minutes}min`;
  };

  const formatDateTime = (dateString: string) => {
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(dateString));
  };

  if (loading) {
    return <ReportLoadingState />;
  }

  if (!sessionId || sessionQuery.isError || !data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
        Impossible de charger les données de la session. Veuillez réessayer.
      </div>
    );
  }

  if (data.hasExistingReport) {
    return (
      <div className="space-y-4">
        <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-emerald-700">
            Rapport deja soumis
          </p>
          <h2 className="mt-2 text-xl font-black text-emerald-950">
            Cette session a deja un rapport
          </h2>
          <p className="mt-2 text-sm leading-6 text-emerald-900">
            Le rapport n&apos;est plus modifiable depuis l&apos;application terrain.
          </p>
        </section>

        <button
          className="flex min-h-14 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-black text-white"
          onClick={() => router.push('/mobile/history')}
          type="button"
        >
          Voir dans l&apos;historique
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-20">
      {/* En-tête récapitulatif de la session */}
      <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <h2 className="text-lg font-bold text-emerald-950 mb-3">Récapitulatif de la session</h2>
        
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-sm text-emerald-700">Site:</span>
            <span className="text-sm font-semibold text-emerald-900">{data.session.siteName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-emerald-700">Date:</span>
            <span className="text-sm font-semibold text-emerald-900">
              {formatDateTime(data.session.date)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-emerald-700">Arrivée:</span>
            <span className="text-sm font-semibold text-emerald-900">
              {formatDateTime(data.session.arrivalAt)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-emerald-700">Départ:</span>
            <span className="text-sm font-semibold text-emerald-900">
              {formatDateTime(data.session.departureAt)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-emerald-700">Durée effective:</span>
            <span className="text-sm font-semibold text-emerald-900">
              {formatDuration(data.session.effectiveDurationSeconds)}
            </span>
          </div>
          {data.session.pauseDurationSeconds > 0 && (
            <div className="flex justify-between">
              <span className="text-sm text-emerald-700">Durée pauses:</span>
              <span className="text-sm font-semibold text-emerald-900">
                {formatDuration(data.session.pauseDurationSeconds)}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-sm text-emerald-700">Photos prises:</span>
            <span className="text-sm font-semibold text-emerald-900">
              {data.session.photoCount}
            </span>
          </div>
        </div>
      </section>

      {/* Assignation du jour */}
      {data.assignment && (
        <section className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-blue-500 mb-2">
            Assignation du jour
          </h3>
          <div className="bg-white rounded-lg p-3">
            <p className="text-sm font-medium text-blue-900">
              Action prévue : {data.assignment.action}
            </p>
            {data.assignment.targetProgress && (
              <p className="text-xs text-blue-700 mt-1">
                Cible de progression : {data.assignment.targetProgress}%
              </p>
            )}
            {data.assignment.objectiveText ? (
              <p className="mt-1 text-xs text-blue-700">Objectif : {data.assignment.objectiveText}</p>
            ) : null}
            {data.assignment.actualProgress !== null && data.assignment.actualProgress !== undefined ? (
              <p className="mt-1 text-xs font-semibold text-blue-800">
                Dernier avancement déclaré : {data.assignment.actualProgress}%
                {data.assignment.latestProgressBlocked ? ' - blocage signalé' : ''}
              </p>
            ) : null}
          </div>
        </section>
      )}

      {/* Zone de saisie du rapport */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          Rapport de la journée
        </h3>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Décrivez les travaux réalisés, l'avancement, les difficultés rencontrées..."
            className="w-full h-32 resize-none rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700 placeholder-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            rows={6}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          Fichier de rapport (optionnel)
        </h3>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
          <input
            accept=".pdf,.xlsx,.xls,.docx,.png,.jpg,.jpeg"
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700 file:mr-3 file:rounded-full file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-bold file:text-white"
            onChange={(event) => setReportFile(event.target.files?.[0] ?? null)}
            type="file"
          />
          <p className="mt-2 text-xs font-semibold text-slate-500">
            PDF, Excel, Word ou image. Les fichiers demandent une connexion.
          </p>
          {reportFile ? <p className="mt-2 text-sm font-bold text-primary">{reportFile.name}</p> : null}
        </div>
      </section>

      {/* Champ progression */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          Progression réalisée
        </h3>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Progression aujourd&apos;hui :</span>
              <span className="text-lg font-bold text-primary">{progressPercentage}%</span>
            </div>
            
            {/* Slider */}
            <div className="relative">
              <input
                type="range"
                min="0"
                max="100"
                value={progressPercentage}
                onChange={(e) => setProgressPercentage(parseInt(e.target.value))}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer slider"
              />
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>

            {/* Champ numérique alternatif */}
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                max="100"
                value={progressPercentage}
                onChange={(e) => setProgressPercentage(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                className="w-20 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-center font-medium focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <span className="text-sm text-slate-600">%</span>
            </div>

            {data.assignment?.targetProgress && (
              <div className="text-xs text-slate-500">
                Cible planning : {data.assignment.targetProgress}%
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Champ blocage / remarque */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          Blocage / Remarque (optionnel)
        </h3>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
          <input
            type="text"
            value={blockageNote}
            onChange={(e) => setBlockageNote(e.target.value)}
            placeholder="Ex : Accès route coupée, matériel manquant..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 placeholder-slate-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      </section>

      {/* Boutons d'action */}
      <section className="space-y-3">
        <button
          onClick={handleSubmit}
          disabled={(!content.trim() && !reportFile) || submitMutation.isPending}
          className="flex w-full items-center justify-center rounded-lg bg-primary px-5 py-4 text-center text-base font-black text-white shadow-lg transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitMutation.isPending ? 'Soumission...' : 'Soumettre le rapport'}
        </button>
        
        <button
          onClick={handleSkip}
          disabled={submitMutation.isPending}
          className="flex w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-5 py-4 text-center text-base font-semibold text-slate-700 shadow-lg transition active:scale-[0.98] disabled:opacity-50"
        >
          Passer
        </button>
      </section>

      {/* Message offline */}
      {submitMutation.data?.isOffline && (
        <section className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm font-semibold text-orange-700">
          ✅ Rapport sauvegardé hors ligne. Il sera synchronisé automatiquement lorsque vous serez connecté.
        </section>
      )}
      {submitMutation.isError ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          {submitMutation.error instanceof Error ? submitMutation.error.message : "Le rapport n'a pas pu être soumis."}
        </section>
      ) : null}
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
      <div className="h-40 animate-pulse rounded-lg bg-slate-100" />
      <div className="space-y-3">
        <div className="h-5 w-32 animate-pulse rounded bg-slate-100" />
        <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
      </div>
    </div>
  );
}
