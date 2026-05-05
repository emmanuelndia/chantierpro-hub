'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClockInType } from '@prisma/client';
import { authFetch } from '@/lib/auth/client-session';
import { haversineDistanceKm } from '@/lib/haversine';
import {
  createOfflineClockInId,
  enqueueOfflineClockIn,
  enqueueOfflineComment,
  enqueueOfflineReport,
  getMobileClockInPendingCount,
} from '@/lib/mobile-clock-in-offline';
import type {
  ClockInRecordItem,
  SessionStatus,
  TodayClockInView,
} from '@/types/clock-in';
import { getMobileOfflineCache, setMobileOfflineCache, syncMobileOfflineQueue } from '@/lib/mobile-offline-db';
import { useGeolocation } from '@/lib/hooks/useGeolocation';
import type { TodaySiteItem } from '@/types/projects';
import type { NearbySiteItem } from '@/types/reports';

type ClockInIntent = 'arrival' | 'departure' | 'pause-start' | 'pause-end';
type Step = 'clock-in' | 'comment' | 'report' | 'confirmation';

type GeoState =
  | { status: 'loading' }
  | { status: 'ready'; latitude: number; longitude: number; accuracy: number | null }
  | { status: 'unavailable'; message: string };

type SelectableSite = {
  id: string;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  radiusKm: number;
  distanceKm: number | null;
};

type Submission = {
  clientId: string;
  offline: boolean;
  record: ClockInRecordItem | null;
  type: ClockInType;
  siteId: string;
  siteName: string;
  timestampLocal: string;
  durationSeconds: number | null;
};

type TodaySitesResponse = {
  items: TodaySiteItem[];
};

type NearbySitesResponse = {
  sites: NearbySiteItem[];
};

const intentToType: Record<ClockInIntent, ClockInType> = {
  arrival: 'ARRIVAL',
  departure: 'DEPARTURE',
  'pause-start': 'PAUSE_START',
  'pause-end': 'PAUSE_END',
};

const typeLabels: Record<string, string> = {
  ARRIVAL: 'Entree',
  DEPARTURE: 'Sortie',
  PAUSE_START: 'Pause',
  PAUSE_END: 'Reprise',
  INTERMEDIATE: 'Intermediaire',
};

export function MobileClockInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const requestedSiteId = searchParams.get('siteId');
  const requestedIntent = parseIntent(searchParams.get('intent'));
  
  // Utiliser le nouveau hook de géolocalisation
  const geolocation = useGeolocation({
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 0,
  });

  // Convertir l'état du hook vers le format GeoState existant
  const geoState: GeoState = geolocation.loading 
    ? { status: 'loading' }
    : geolocation.error 
    ? { status: 'unavailable', message: geolocation.error }
    : { 
        status: 'ready', 
        latitude: geolocation.latitude!, 
        longitude: geolocation.longitude!, 
        accuracy: geolocation.accuracy 
      };

  const [manualMode, setManualMode] = useState(Boolean(requestedSiteId));
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(requestedSiteId);
  const [selectedIntent, setSelectedIntent] = useState<ClockInIntent>(requestedIntent ?? 'arrival');
  const [step, setStep] = useState<Step>('clock-in');
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [comment, setComment] = useState('');
  const [reportContent, setReportContent] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void refreshPendingCount();

    async function sync() {
      await syncMobileOfflineQueue({ mode: 'auto' });
      await refreshPendingCount();
      await queryClient.invalidateQueries({ queryKey: ['mobile-clock-in-today'] });
      await queryClient.invalidateQueries({ queryKey: ['mobile-clock-in-history'] });
    }

    const handleOnline = () => {
      void sync();
    };

    if (navigator.onLine) {
      handleOnline();
    }

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [queryClient]);

  const todayQuery = useQuery({
    queryKey: ['mobile-clock-in-today'],
    queryFn: async () => {
      const response = await authFetch('/api/users/me/clock-in');

      if (!response.ok) {
        throw new Error('Clock-in status failed');
      }

      return (await response.json()) as TodayClockInView;
    },
    refetchInterval: 30_000,
    staleTime: 30_000,
  });

  const todaySitesQuery = useQuery({
    queryKey: ['mobile-sites-today'],
    queryFn: async () => {
      const response = await authFetch('/api/users/me/sites/today');

      if (!response.ok) {
        const cached = await getMobileOfflineCache<TodaySitesResponse>('sites-today');

        if (cached) {
          return cached.payload;
        }

        throw new Error('Today sites failed');
      }

      const payload = (await response.json()) as TodaySitesResponse;
      await setMobileOfflineCache('sites-today', payload, 24 * 60 * 60 * 1000);
      return payload;
    },
    enabled: manualMode || Boolean(requestedSiteId) || Boolean(todayQuery.data?.activeSession),
    staleTime: 300_000,
  });

  const nearbyQuery = useQuery({
    queryKey: ['mobile-sites-nearby', geoState.status === 'ready' ? geoState.latitude : null, geoState.status === 'ready' ? geoState.longitude : null],
    queryFn: async () => {
      if (geoState.status !== 'ready') {
        return { sites: [] } satisfies NearbySitesResponse;
      }

      const response = await authFetch(
        `/api/sites/nearby?lat=${encodeURIComponent(geoState.latitude)}&lng=${encodeURIComponent(geoState.longitude)}`,
      );

      if (!response.ok) {
        throw new Error('Nearby sites failed');
      }

      return (await response.json()) as NearbySitesResponse;
    },
    enabled: geoState.status === 'ready' && !manualMode && !requestedSiteId,
    staleTime: 30_000,
  });

  const todaySites = useMemo(() => todaySitesQuery.data?.items ?? [], [todaySitesQuery.data?.items]);
  const activeSession = todayQuery.data?.activeSession ?? null;
  const quickSite = nearbyQuery.data?.sites[0] ?? null;

  useEffect(() => {
    if (requestedIntent) {
      setSelectedIntent(requestedIntent);
      return;
    }

    if (activeSession) {
      setSelectedIntent('departure');
    }
  }, [activeSession, requestedIntent]);

  useEffect(() => {
    if (!selectedSiteId && activeSession?.siteId) {
      setSelectedSiteId(activeSession.siteId);
      setManualMode(true);
    }
  }, [activeSession?.siteId, selectedSiteId]);

  const selectedSite = useMemo(() => {
    const siteFromToday = todaySites.find((site) => site.id === selectedSiteId);

    if (siteFromToday) {
      return fromTodaySite(siteFromToday, geoState);
    }

    if (!manualMode && quickSite) {
      return fromNearbySite(quickSite);
    }

    return null;
  }, [geoState, manualMode, quickSite, selectedSiteId, todaySites]);

  const sessionStatusQuery = useQuery({
    queryKey: ['mobile-session-status', selectedSite?.id],
    queryFn: async () => {
      if (!selectedSite) {
        return null;
      }

      const response = await authFetch(`/api/sites/${selectedSite.id}/clock-in/session-status`);

      if (!response.ok) {
        return null;
      }

      return (await response.json()) as SessionStatus;
    },
    enabled: Boolean(selectedSite),
    refetchInterval: 15_000,
    staleTime: 30_000,
  });

  const sessionStatus = sessionStatusQuery.data;
  const hasOpenSession = Boolean(sessionStatus?.sessionOpen ?? activeSession);
  const pauseActive = Boolean(sessionStatus?.pauseActive);
  const pauseSeconds = pauseActive ? elapsedSeconds(null, now, sessionStatus?.pauseDuration) : 0;
  const currentIntent = pauseActive && selectedIntent === 'pause-start' ? 'pause-end' : selectedIntent;
  const currentType = intentToType[currentIntent];
  const selectedDistance = selectedSite?.distanceKm ?? null;
  const outsideRadius = currentType === 'ARRIVAL' && selectedDistance !== null && selectedSite ? selectedDistance > selectedSite.radiusKm : false;

  const clockInMutation = useMutation({
    mutationFn: submitClockIn,
    onSuccess: async (result) => {
      setSubmission(result);
      setErrorMessage(null);
      setComment('');
      setReportContent('');
      setStep('comment');
      await refreshPendingCount();
      await queryClient.invalidateQueries({ queryKey: ['mobile-clock-in-today'] });
      await queryClient.invalidateQueries({ queryKey: ['mobile-clock-in-history'] });
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : 'Pointage impossible.');
    },
  });

  const commentMutation = useMutation({
    mutationFn: async () => {
      if (!submission || comment.trim() === '') {
        return;
      }

      if (submission.offline) {
        await enqueueOfflineComment({ clientId: submission.clientId, comment: comment.trim() });
        await refreshPendingCount();
        return;
      }

      if (!submission.record) {
        return;
      }

      const response = await authFetch(`/api/clock-in/${submission.record.id}/comment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: comment.trim() }),
      });

      if (!response.ok) {
        throw new Error(await readApiMessage(response, 'Commentaire impossible.'));
      }
    },
    onSuccess: () => moveAfterComment(),
    onError: (error) => setErrorMessage(error instanceof Error ? error.message : 'Commentaire impossible.'),
  });

  const reportMutation = useMutation({
    mutationFn: async () => {
      if (!submission || reportContent.trim() === '') {
        return;
      }

      if (submission.offline) {
        await enqueueOfflineReport({
          clientId: submission.clientId,
          siteId: submission.siteId,
          content: reportContent.trim(),
        });
        await refreshPendingCount();
        return;
      }

      if (!submission.record) {
        return;
      }

      const response = await authFetch(`/api/sites/${submission.siteId}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: reportContent.trim(),
          clockInRecordId: submission.record.id,
        }),
      });

      if (!response.ok) {
        throw new Error(await readApiMessage(response, 'Rapport impossible.'));
      }
    },
    onSuccess: () => setStep('confirmation'),
    onError: (error) => setErrorMessage(error instanceof Error ? error.message : 'Rapport impossible.'),
  });

  const canSubmit =
    Boolean(selectedSite) &&
    geoState.status === 'ready' &&
    !outsideRadius &&
    !clockInMutation.isPending;

  useEffect(() => {
    if (step !== 'confirmation') {
      return;
    }

    const timer = window.setTimeout(() => router.push('/mobile/home'), 4_000);
    return () => window.clearTimeout(timer);
  }, [router, step]);

  async function submitClockIn(intentOverride?: ClockInIntent): Promise<Submission> {
    if (!selectedSite || geoState.status !== 'ready') {
      throw new Error('Position ou chantier indisponible.');
    }

    const actionIntent = intentOverride ?? currentIntent;
    const actionType = intentToType[actionIntent];
    const actionOutsideRadius =
      actionType === 'ARRIVAL' &&
      selectedSite.distanceKm !== null &&
      selectedSite.distanceKm > selectedSite.radiusKm;

    if (actionOutsideRadius) {
      throw new Error('Vous etes hors du rayon autorise.');
    }

    const timestampLocal = new Date().toISOString();
    const clientId = createOfflineClockInId();
    const payload = {
      siteId: selectedSite.id,
      type: actionType,
      latitude: geoState.latitude,
      longitude: geoState.longitude,
      accuracy: geoState.accuracy,
      timestampLocal,
    };

    if (!navigator.onLine) {
      await enqueueOfflineClockIn({
        clientId,
        siteName: selectedSite.name,
        ...payload,
      });

      return {
        clientId,
        offline: true,
        record: null,
        type: actionType,
        siteId: selectedSite.id,
        siteName: selectedSite.name,
        timestampLocal,
        durationSeconds: actionType === 'DEPARTURE' ? sessionStatus?.duration ?? activeSession?.durationSeconds ?? null : null,
      };
    }

    const response = await authFetch(`/api/sites/${selectedSite.id}/clock-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(await readApiMessage(response, 'Pointage refuse.'));
    }

    const data = (await response.json()) as { record: ClockInRecordItem };

    return {
      clientId,
      offline: false,
      record: data.record,
      type: actionType,
      siteId: selectedSite.id,
      siteName: selectedSite.name,
      timestampLocal: data.record.timestampLocal,
      durationSeconds: actionType === 'DEPARTURE' ? sessionStatus?.duration ?? activeSession?.durationSeconds ?? null : null,
    };
  }

  async function refreshPendingCount() {
    setPendingCount(await getMobileClockInPendingCount());
  }

  
  function moveAfterComment() {
    if (submission?.type === 'DEPARTURE') {
      setStep('report');
      return;
    }

    setStep('confirmation');
  }

  if (step === 'confirmation' && submission) {
    return <ConfirmationView submission={submission} />;
  }

  if (step === 'comment' && submission) {
    return (
      <PostClockInPanel
        busy={commentMutation.isPending}
        errorMessage={errorMessage}
        label="Ajouter un commentaire (optionnel)"
        onPrimary={() => commentMutation.mutate()}
        onSkip={moveAfterComment}
        primaryLabel="Envoyer"
        setValue={setComment}
        title="Commentaire"
        value={comment}
      />
    );
  }

  if (step === 'report' && submission) {
    return (
      <PostClockInPanel
        busy={reportMutation.isPending}
        errorMessage={errorMessage}
        label="Rapport de fin de session"
        onPrimary={() => reportMutation.mutate()}
        onSkip={() => setStep('confirmation')}
        primaryLabel="Soumettre"
        setValue={setReportContent}
        title="Rapport de fin de session"
        value={reportContent}
      />
    );
  }

  return (
    <div className="space-y-5">
      {pendingCount > 0 ? (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-800">
          Synchronisation en attente : {pendingCount}
        </div>
      ) : null}

      <section className="rounded-lg border border-primary/20 bg-primary/10 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Pointage</p>
        <h2 className="mt-2 text-2xl font-black text-slate-950">{typeLabels[currentType]}</h2>
        <p className="mt-1 text-sm text-slate-600">
          Validation GPS puis controle serveur du chantier.
        </p>
      </section>

      <GpsPanel
        geoState={geoState}
        onRetry={geolocation.refresh}
        outsideRadius={outsideRadius}
        selectedSite={selectedSite}
        canRetry={geolocation.canRetry}
      />

      {geoState.status === 'ready' && geoState.accuracy !== null && geoState.accuracy > 100 ? (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm font-semibold text-yellow-900">
          Precision GPS faible ({Math.round(geoState.accuracy)} m). Vous pouvez continuer, mais le serveur verifiera la position.
        </div>
      ) : null}

      {!manualMode && geoState.status === 'ready' ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
          {nearbyQuery.isLoading ? (
            <p className="text-sm font-semibold text-slate-500">Recherche du chantier le plus proche...</p>
          ) : quickSite ? (
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
                Chantier detecte
              </p>
              <h3 className="mt-2 text-lg font-black text-slate-950">{quickSite.name}</h3>
              <p className="mt-1 text-sm text-slate-500">{quickSite.address}</p>
              <p className="mt-3 text-sm font-bold text-emerald-700">
                {quickSite.distance.toFixed(2)} km - rayon : {quickSite.radiusKm} km
              </p>
            </div>
          ) : (
            <div>
              <p className="text-base font-black text-slate-950">Aucun chantier dans votre zone</p>
              <button
                className="mt-4 min-h-14 rounded-lg border border-slate-300 px-4 text-sm font-bold text-slate-700"
                onClick={() => setManualMode(true)}
                type="button"
              >
                Choisir manuellement
              </button>
            </div>
          )}
        </section>
      ) : null}

      {manualMode ? (
        <ManualSiteList
          geoState={geoState}
          loading={todaySitesQuery.isLoading}
          onSelect={setSelectedSiteId}
          selectedSiteId={selectedSite?.id ?? null}
          sites={todaySites}
        />
      ) : null}

      {selectedSite ? (
        <section className="space-y-3">
          {hasOpenSession ? (
            <>
              <ActionButton
                busy={clockInMutation.isPending && currentType === 'DEPARTURE'}
                disabled={geoState.status !== 'ready' || clockInMutation.isPending}
                label="POINTER SORTIE"
                onClick={() => {
                  setSelectedIntent('departure');
                  clockInMutation.mutate('departure');
                }}
                tone="danger"
              />
              <ActionButton
                busy={clockInMutation.isPending && (currentType === 'PAUSE_START' || currentType === 'PAUSE_END')}
                disabled={geoState.status !== 'ready' || clockInMutation.isPending}
                label={pauseActive ? 'REPRENDRE' : 'PAUSE'}
                onClick={() => {
                  const intent = pauseActive ? 'pause-end' : 'pause-start';
                  setSelectedIntent(intent);
                  clockInMutation.mutate(intent);
                }}
                tone={pauseActive ? 'success' : 'warning'}
              />
              {pauseActive ? (
                <p className="text-center text-sm font-bold text-orange-800">
                  Pause depuis {formatShortDuration(pauseSeconds)}
                </p>
              ) : null}
            </>
          ) : (
            <ActionButton
              busy={clockInMutation.isPending}
              disabled={!canSubmit}
              label={quickSite && !manualMode ? 'POINTER ICI' : 'POINTER ENTREE'}
              onClick={() => {
                setSelectedIntent('arrival');
                clockInMutation.mutate('arrival');
              }}
              tone="primary"
            />
          )}
        </section>
      ) : null}

      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <Link className="block text-center text-sm font-bold text-slate-500" href="/mobile/home">
        Retour accueil
      </Link>
    </div>
  );
}

function GpsPanel({
  geoState,
  onRetry,
  outsideRadius,
  selectedSite,
  canRetry,
}: Readonly<{
  geoState: GeoState;
  onRetry: () => void;
  outsideRadius: boolean;
  selectedSite: SelectableSite | null;
  canRetry?: boolean;
}>) {
  if (geoState.status === 'loading') {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-panel">
        <Spinner className="mx-auto h-12 w-12 text-primary" />
        <p className="mt-4 text-lg font-black text-slate-950">Localisation en cours...</p>
      </section>
    );
  }

  if (geoState.status === 'unavailable') {
    return (
      <section className="rounded-lg border border-orange-200 bg-orange-50 p-5 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-orange-100 text-orange-700">
          <MapPinIcon className="h-9 w-9" />
        </div>
        <h3 className="mt-4 text-lg font-black text-slate-950">GPS indisponible</h3>
        <p className="mt-2 text-sm leading-6 text-orange-900">{geoState.message}</p>
        {canRetry !== false && (
          <button
            className="mt-5 min-h-14 rounded-lg bg-orange-600 px-5 text-sm font-bold text-white"
            onClick={onRetry}
            type="button"
          >
            Réessayer
          </button>
        )}
      </section>
    );
  }

  const distance = selectedSite?.distanceKm ?? null;
  const inRadius = Boolean(selectedSite && distance !== null && !outsideRadius);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-panel">
      <div
        className={`mx-auto flex h-28 w-28 items-center justify-center rounded-full border-8 ${
          inRadius ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'
        }`}
      >
        <MapPinIcon className="h-12 w-12" />
      </div>
      <h3 className="mt-4 text-lg font-black text-slate-950">
        {selectedSite ? selectedSite.name : 'Position recuperee'}
      </h3>
      <p className={`mt-2 text-sm font-bold ${inRadius ? 'text-emerald-700' : 'text-red-700'}`}>
        {selectedSite && distance !== null
          ? outsideRadius
            ? `${distance.toFixed(2)} km - rayon : ${selectedSite.radiusKm} km`
            : `${distance.toFixed(2)} km du chantier`
          : 'Choisissez un chantier pour verifier le rayon'}
      </p>
    </section>
  );
}

function ManualSiteList({
  geoState,
  loading,
  onSelect,
  selectedSiteId,
  sites,
}: Readonly<{
  geoState: GeoState;
  loading: boolean;
  onSelect: (siteId: string) => void;
  selectedSiteId: string | null;
  sites: TodaySiteItem[];
}>) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
        Chantiers du jour
      </h3>
      {loading ? (
        <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
      ) : sites.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500">
          Aucun chantier assigne aujourd&apos;hui
        </div>
      ) : (
        <div className="space-y-2">
          {sites.map((site) => {
            const selectableSite = fromTodaySite(site, geoState);
            return (
              <button
                className={`w-full rounded-lg border p-4 text-left transition ${
                  selectedSiteId === site.id ? 'border-primary bg-primary/10' : 'border-slate-200 bg-white'
                }`}
                key={site.id}
                onClick={() => onSelect(site.id)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-black text-slate-950">{site.name}</p>
                    <p className="mt-1 truncate text-sm text-slate-500">{site.address}</p>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-primary">
                    {selectableSite.distanceKm === null ? 'N/A' : `${selectableSite.distanceKm.toFixed(2)} km`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ActionButton({
  busy,
  disabled,
  label,
  onClick,
  tone,
}: Readonly<{
  busy: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
  tone: 'danger' | 'primary' | 'success' | 'warning';
}>) {
  const toneClassName = {
    danger: 'bg-danger text-white',
    primary: 'bg-orange-600 text-white',
    success: 'bg-success text-white',
    warning: 'bg-warning text-slate-950',
  }[tone];

  return (
    <button
      className={`flex min-h-20 w-full items-center justify-center rounded-lg px-5 text-base font-black tracking-[0.08em] shadow-lg transition disabled:cursor-not-allowed disabled:opacity-50 ${toneClassName}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {busy ? <Spinner className="h-6 w-6" /> : label}
    </button>
  );
}

function PostClockInPanel({
  busy,
  errorMessage,
  label,
  onPrimary,
  onSkip,
  primaryLabel,
  setValue,
  title,
  value,
}: Readonly<{
  busy: boolean;
  errorMessage: string | null;
  label: string;
  onPrimary: () => void;
  onSkip: () => void;
  primaryLabel: string;
  setValue: (value: string) => void;
  title: string;
  value: string;
}>) {
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-panel">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Pointage valide</p>
        <h2 className="mt-2 text-2xl font-black text-slate-950">{title}</h2>
      </div>
      <label className="block text-sm font-bold text-slate-700" htmlFor="post-clock-in-text">
        {label}
      </label>
      <textarea
        className="min-h-36 w-full rounded-lg border border-slate-300 p-3 text-base outline-none focus:border-primary"
        id="post-clock-in-text"
        onChange={(event) => setValue(event.target.value)}
        value={value}
      />
      {errorMessage ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
          {errorMessage}
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <button
          className="min-h-14 rounded-lg border border-slate-300 px-4 text-sm font-bold text-slate-700"
          disabled={busy}
          onClick={onSkip}
          type="button"
        >
          Passer
        </button>
        <button
          className="flex min-h-14 items-center justify-center rounded-lg bg-primary px-4 text-sm font-bold text-white disabled:opacity-50"
          disabled={busy || value.trim() === ''}
          onClick={onPrimary}
          type="button"
        >
          {busy ? <Spinner className="h-5 w-5" /> : primaryLabel}
        </button>
      </div>
    </section>
  );
}

function ConfirmationView({ submission }: Readonly<{ submission: Submission }>) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 text-center shadow-panel">
      <div
        className={`mx-auto flex h-28 w-28 animate-pulse items-center justify-center rounded-full ${
          submission.offline ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'
        }`}
      >
        {submission.offline ? <ClockIcon className="h-14 w-14" /> : <CheckIcon className="h-14 w-14" />}
      </div>
      <h2 className="mt-5 text-2xl font-black text-slate-950">
        {submission.offline ? 'Pointage en attente' : 'Pointage confirme'}
      </h2>
      <div className="mt-5 space-y-3 rounded-lg bg-slate-50 p-4 text-left text-sm">
        <SummaryRow label="Type" value={typeLabels[submission.type] ?? submission.type} />
        <SummaryRow label="Chantier" value={submission.siteName} />
        <SummaryRow label="Date" value={formatDate(submission.timestampLocal)} />
        <SummaryRow label="Heure" value={formatTime(submission.timestampLocal)} />
        {submission.durationSeconds !== null ? (
          <SummaryRow label="Duree" value={formatShortDuration(submission.durationSeconds)} />
        ) : null}
      </div>
      <p className="mt-5 text-sm font-semibold text-slate-500">Retour accueil automatique...</p>
    </section>
  );
}

function SummaryRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="truncate font-bold text-slate-950">{value}</span>
    </div>
  );
}

function fromTodaySite(site: TodaySiteItem, geoState: GeoState): SelectableSite {
  const distanceKm =
    geoState.status === 'ready'
      ? haversineDistanceKm(
          { latitude: geoState.latitude, longitude: geoState.longitude },
          { latitude: site.latitude, longitude: site.longitude },
        )
      : null;

  return {
    id: site.id,
    name: site.name,
    address: site.address,
    latitude: site.latitude,
    longitude: site.longitude,
    radiusKm: site.radiusKm,
    distanceKm,
  };
}

function fromNearbySite(site: NearbySiteItem): SelectableSite {
  return {
    id: site.id,
    name: site.name,
    address: site.address,
    latitude: null,
    longitude: null,
    radiusKm: site.radiusKm,
    distanceKm: site.distance,
  };
}

async function readApiMessage(response: Response, fallback: string) {
  try {
    const data = (await response.json()) as { message?: string };
    return data.message ?? fallback;
  } catch {
    return fallback;
  }
}

function parseIntent(value: string | null): ClockInIntent | null {
  if (value === 'arrival' || value === 'departure' || value === 'pause-start' || value === 'pause-end') {
    return value;
  }

  return null;
}

function elapsedSeconds(startedAt: string | null | undefined, now: number, fallback: number | null | undefined) {
  if (startedAt) {
    return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  }

  return Math.max(0, fallback ?? 0);
}

function formatShortDuration(totalSeconds: number) {
  const totalMinutes = Math.max(0, Math.floor(totalSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}min`;
  }

  return `${minutes}min`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function Spinner({ className }: Readonly<{ className: string }>) {
  return (
    <svg aria-hidden="true" className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeLinecap="round" strokeWidth="4" />
    </svg>
  );
}

function baseIcon(className: string, children: ReactNode) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

function MapPinIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11Z" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
    </>,
  );
}

function CheckIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <path d="m5 12 4 4 10-10" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />,
  );
}

function ClockIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 8v5l3 2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </>,
  );
}
