'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import { SignedImage } from './mobile/SignedImage';
import { getMobileOfflineCache, setMobileOfflineCache } from '@/lib/mobile-offline-db';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type {
  SessionSummary,
  DayAssignment,
  SessionPhoto,
  SubmitReportRequest,
  ReportSubmissionResponse,
  SessionReportData,
} from '@/types/mobile-session-report';
import '@/styles/slider.css';

type MobileSessionReportPageProps = Readonly<{
  user: WebSessionUser;
}>;

export function MobileSessionReportPage({ user }: MobileSessionReportPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const [content, setContent] = useState('');
  const [progressPercentage, setProgressPercentage] = useState(50);
  const [blockageNote, setBlockageNote] = useState('');
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);

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
    mutationFn: async (data: SubmitReportRequest) => {
      // Essayer de soumettre en ligne
      try {
        if (!data.siteId) {
          throw new Error('Site ID requis pour la soumission du rapport');
        }

        const response = await authFetch(`/api/sites/${data.siteId}/reports`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content: data.content,
            clockInRecordId: data.clockInRecordId,
            progression: data.progressPercentage,
            blocage: data.blockageNote,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Erreur ${response.status}: Échec de la soumission du rapport`);
        }

        const result = await response.json();
        return {
          success: true,
          reportId: result.report.id,
          message: 'Rapport soumis avec succès',
          report: result.report,
        } as ReportSubmissionResponse;
      } catch (error) {
        console.error('Report submission error:', error);
        
        // Si échec, sauvegarder en offline
        const offlineReport = {
          ...data,
          id: `offline-${Date.now()}`,
          createdAt: new Date().toISOString(),
          userId: user.id,
          isOffline: true,
        };

        // Sauvegarder dans IndexedDB
        const existingOffline = await getMobileOfflineCache<any[]>('offline-reports') || { payload: [] };
        existingOffline.payload.push(offlineReport);
        await setMobileOfflineCache('offline-reports', existingOffline.payload, 7 * 24 * 60 * 60 * 1000); // 7 jours

        return {
          success: true,
          reportId: offlineReport.id,
          message: 'Rapport sauvegardé hors ligne',
          isOffline: true,
        } as ReportSubmissionResponse;
      }
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['mobile-session-report', sessionId] });
      
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
    if (data?.photos) {
      // Sélectionner toutes les photos par défaut
      setSelectedPhotoIds(data.photos.map(photo => photo.id));
    }
  }, [data?.photos]);

  const handleSubmit = () => {
    if (!data || !sessionId) return;

    const reportData: SubmitReportRequest = {
      clockInRecordId: data.session.clockInRecordId,
      content: content.trim(),
      progressPercentage,
      blockageNote: blockageNote.trim() || undefined,
      assignmentId: data.assignment?.id,
      photoIds: selectedPhotoIds,
    };

    submitMutation.mutate(reportData);
  };

  const handleSkip = () => {
    if (confirm('Êtes-vous sûr de vouloir passer sans soumettre de rapport ?')) {
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

      {/* Champ progression */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          Progression réalisée
        </h3>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Progression aujourd'hui :</span>
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

      {/* Photos de la session */}
      {data.photos.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
              Photos de la session
            </h3>
            <span className="text-xs font-semibold text-slate-400">
              {selectedPhotoIds.length}/{data.photos.length} sélectionnées
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {data.photos.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                isSelected={selectedPhotoIds.includes(photo.id)}
                onToggleSelect={() => {
                  setSelectedPhotoIds(prev => 
                    prev.includes(photo.id)
                      ? prev.filter(id => id !== photo.id)
                      : [...prev, photo.id]
                  );
                }}
              />
            ))}
          </div>
        </section>
      )}

      {/* Boutons d'action */}
      <section className="space-y-3">
        <button
          onClick={handleSubmit}
          disabled={!content.trim() || submitMutation.isPending}
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
    </div>
  );
}

// Composants
function PhotoCard({
  photo,
  isSelected,
  onToggleSelect,
}: Readonly<{
  photo: SessionPhoto;
  isSelected: boolean;
  onToggleSelect: () => void;
}>) {
  return (
    <div
      onClick={onToggleSelect}
      className={`relative aspect-square overflow-hidden rounded-lg border-2 cursor-pointer transition active:scale-[0.95] ${
        isSelected 
          ? 'border-primary shadow-lg' 
          : 'border-slate-200'
      }`}
    >
      <SignedImage
        photoId={photo.id}
        alt={photo.filename}
        className="w-full h-full object-cover"
      />
      {isSelected && (
        <div className="absolute top-1 right-1 h-6 w-6 rounded-full bg-primary flex items-center justify-center">
          <CheckIcon className="h-4 w-4 text-white" />
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-slate-950/70 px-1 py-0.5">
        <p className="text-[10px] text-white truncate">
          {new Date(photo.takenAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
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

// Icônes
function CheckIcon({ className }: Readonly<{ className: string }>) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}
