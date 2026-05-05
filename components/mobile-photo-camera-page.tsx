'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch, getAccessToken } from '@/lib/auth/client-session';
import {
  buildPhotoFormData,
  countPendingMobilePhotos,
  createPendingPhotoId,
  enqueuePendingMobilePhoto,
  syncPendingMobilePhotos,
  type PendingMobilePhoto,
} from '@/lib/mobile-photo-offline';
import { getMobilePhotoJpegQuality } from '@/lib/mobile-photo-quality';
import type { MobilePhotoSiteOption, MobilePhotoSitesResponse } from '@/types/mobile-photo';

type CameraState = 'loading' | 'ready' | 'denied';
type FacingMode = 'environment' | 'user';
type GpsState =
  | { status: 'loading' }
  | { status: 'ready'; latitude: number; longitude: number; accuracy: number | null }
  | { status: 'unavailable' };

type CapturedPhoto = {
  blob: Blob;
  previewUrl: string;
  timestampLocal: string;
  latitude: number | null;
  longitude: number | null;
  site: MobilePhotoSiteOption;
};

export function MobilePhotoCameraPage() {
  const searchParams = useSearchParams();
  const requestedSiteId = searchParams.get('siteId');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>('loading');
  const [cameraMessage, setCameraMessage] = useState('');
  const [facingMode, setFacingMode] = useState<FacingMode>('environment');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [gpsState, setGpsState] = useState<GpsState>({ status: 'loading' });
  const [selectedSiteId, setSelectedSiteId] = useState(requestedSiteId ?? '');
  const [siteSheetOpen, setSiteSheetOpen] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const sitesQuery = useQuery({
    queryKey: ['mobile-photo-sites'],
    queryFn: async () => {
      const response = await authFetch('/api/mobile/photo/sites');

      if (!response.ok) {
        throw new Error('Sites photo indisponibles.');
      }

      return (await response.json()) as MobilePhotoSitesResponse;
    },
  });

  const sites = useMemo(() => sitesQuery.data?.items ?? [], [sitesQuery.data?.items]);
  const selectedSite = useMemo(
    () => sites.find((site) => site.id === selectedSiteId) ?? sites.find((site) => site.hasOpenSession) ?? sites[0] ?? null,
    [selectedSiteId, sites],
  );

  useEffect(() => {
    if (!selectedSiteId && selectedSite) {
      setSelectedSiteId(selectedSite.id);
    }
  }, [selectedSite, selectedSiteId]);

  useEffect(() => {
    void startCamera();
    return stopCamera;
    // Camera restart is intentionally tied to facing mode changes only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facingMode]);

  useEffect(() => {
    requestGps();
  }, []);

  useEffect(() => {
    void refreshPendingCount();

    const handleOnline = () => {
      void syncPendingMobilePhotos().finally(refreshPendingCount);
    };

    if (navigator.onLine) {
      handleOnline();
    }

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  useEffect(() => {
    if (!capturedPhoto) {
      return;
    }

    return () => URL.revokeObjectURL(capturedPhoto.previewUrl);
  }, [capturedPhoto]);

  // Libération propre de la caméra au démontage
  useEffect(() => {
    return () => {
      // Arrêter toutes les pistes du stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => {
          track.stop();
        });
        streamRef.current = null;
      }
      
      // Nettoyer la référence vidéo
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, []);

  async function startCamera() {
    setCameraState('loading');
    setCameraMessage('');

    // Vérifier le support avec fallbacks pour anciens navigateurs
    let getUserMedia: typeof navigator.mediaDevices.getUserMedia | null = null;
    
    if (navigator.mediaDevices?.getUserMedia) {
      getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    } else {
      // Fallbacks pour anciens navigateurs
      const nav = navigator as any;
      getUserMedia = nav.getUserMedia || nav.webkitGetUserMedia || nav.mozGetUserMedia;
      
      if (getUserMedia) {
        // Wrapper pour l'ancienne API
        getUserMedia = (constraints) => new Promise((resolve, reject) => {
          getUserMedia.call(navigator, constraints, resolve, reject);
        });
      }
    }

    if (!getUserMedia) {
      setCameraMessage("La caméra n'est pas supportée sur ce navigateur.");
      setCameraState('denied');
      return;
    }

    try {
      const stream = await getUserMedia({
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('autoplay', 'true');
        videoRef.current.muted = true;
        
        // Forcer la lecture pour iOS
        try {
          await videoRef.current.play();
        } catch (playError) {
          console.warn('Video play failed:', playError);
        }
      }

      setCameraState('ready');
      setTorchSupported(canUseTorch(stream));
    } catch (err: any) {
      let errorMessage = 'Impossible d\'accéder à la caméra.';
      
      switch (err.name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
          errorMessage = 'Permission caméra refusée. Autorisez la caméra dans les paramètres du navigateur.';
          break;
        case 'NotFoundError':
        case 'DevicesNotFoundError':
          errorMessage = 'Aucune caméra détectée sur cet appareil.';
          break;
        case 'NotReadableError':
        case 'TrackStartError':
          errorMessage = 'La caméra est utilisée par une autre application.';
          break;
        case 'OverconstrainedError':
        case 'ConstraintNotSatisfiedError':
          errorMessage = 'La caméra ne supporte pas les contraintes demandées.';
          break;
        case 'SecurityError':
          errorMessage = 'Accès à la caméra bloqué pour des raisons de sécurité.';
          break;
        default:
          errorMessage = `Erreur caméra: ${err.message || 'Erreur inconnue'}`;
      }
      
      setCameraMessage(errorMessage);
      setCameraState('denied');
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function requestGps() {
    setGpsState({ status: 'loading' });

    if (!navigator.geolocation) {
      setGpsState({ status: 'unavailable' });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGpsState({
          status: 'ready',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        });
      },
      () => setGpsState({ status: 'unavailable' }),
      {
        enableHighAccuracy: true,
        maximumAge: 60_000,
        timeout: 10_000,
      },
    );
  }

  async function capturePhoto() {
    if (!videoRef.current || !selectedSite) {
      return;
    }

    const video = videoRef.current;
    
    // Utiliser les dimensions réelles de la vidéo
    const videoWidth = video.videoWidth || 1280;
    const videoHeight = video.videoHeight || 720;
    
    const canvas = document.createElement('canvas');
    canvas.width = videoWidth;
    canvas.height = videoHeight;
    const context = canvas.getContext('2d');

    if (!context) {
      setCameraMessage('Capture impossible.');
      return;
    }

    try {
      // Dessiner l'image de la vidéo sur le canvas
      context.drawImage(video, 0, 0, videoWidth, videoHeight);
      
      // Capturer avec une qualité JPEG optimisée
      const blob = await new Promise<Blob | null>((resolve, reject) => {
        canvas.toBlob(
          (blob) => blob ? resolve(blob) : reject(new Error('Capture échouée')),
          'image/jpeg',
          0.85 // Qualité fixe à 85% pour un bon équilibre
        );
      });

      if (!blob) {
        setCameraMessage('Capture impossible.');
        return;
      }

      // Vibration pour confirmer la capture (si supporté)
      navigator.vibrate?.(60);

      setCapturedPhoto({
        blob,
        previewUrl: URL.createObjectURL(blob),
        timestampLocal: new Date().toISOString(),
        latitude: gpsState.status === 'ready' ? gpsState.latitude : null,
        longitude: gpsState.status === 'ready' ? gpsState.longitude : null,
        site: selectedSite,
      });
      setConfirmationMessage(null);
      setUploadProgress(0);
    } catch (error) {
      setCameraMessage('Erreur lors de la capture photo.');
      console.error('Capture error:', error);
    }
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];

    if (!track) {
      return;
    }

    try {
      await track.applyConstraints({
        advanced: [{ torch: !torchEnabled } as MediaTrackConstraintSet],
      });
      setTorchEnabled((current) => !current);
    } catch {
      setTorchSupported(false);
    }
  }

  async function sendPhoto() {
    if (!capturedPhoto) {
      return;
    }

    const pendingPhoto = toPendingPhoto(capturedPhoto);

    if (!navigator.onLine) {
      await enqueuePendingMobilePhoto(pendingPhoto);
      await refreshPendingCount();
      setConfirmationMessage('Photo en attente de synchronisation.');
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      await uploadPhotoWithProgress(pendingPhoto, setUploadProgress);
      setConfirmationMessage('Photo envoyee.');
      setCapturedPhoto(null);
      await refreshPendingCount();
    } catch {
      await enqueuePendingMobilePhoto(pendingPhoto);
      await refreshPendingCount();
      setConfirmationMessage('Photo stockee hors ligne, synchronisation au retour reseau.');
    } finally {
      setUploading(false);
    }
  }

  async function refreshPendingCount() {
    setPendingCount(await countPendingMobilePhotos());
  }

  if (capturedPhoto) {
    return (
      <PhotoConfirmation
        confirmationMessage={confirmationMessage}
        onRetry={() => {
          setCapturedPhoto(null);
          setConfirmationMessage(null);
        }}
        onSend={() => {
          void sendPhoto();
        }}
        photo={capturedPhoto}
        pendingCount={pendingCount}
        progress={uploadProgress}
        uploading={uploading}
      />
    );
  }

  if (cameraState === 'denied') {
    return (
      <section className="flex min-h-[70dvh] flex-col items-center justify-center rounded-lg border border-orange-200 bg-orange-50 p-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-orange-100 text-orange-700">
          <CameraIcon className="h-10 w-10" />
        </div>
        <h2 className="mt-5 text-2xl font-black text-slate-950">Camera indisponible</h2>
        <p className="mt-3 text-sm leading-6 text-orange-900">
          {cameraMessage || 'Autorisez la camera dans les reglages du navigateur puis reessayez.'}
        </p>
        <button
          className="mt-6 min-h-14 rounded-lg bg-orange-600 px-5 text-sm font-bold text-white"
          onClick={() => {
            void startCamera();
          }}
          type="button"
        >
          Reglages camera
        </button>
      </section>
    );
  }

  return (
    <div className="-mx-4 -my-4 min-h-[calc(100dvh-10rem)] bg-slate-950 text-white">
      <div className="relative min-h-[calc(100dvh-10rem)] overflow-hidden">
        <video ref={videoRef} autoPlay className="absolute inset-0 h-full w-full object-cover" muted playsInline />

        {cameraState === 'loading' ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
            <div className="text-center">
              <Spinner className="mx-auto h-12 w-12 text-white" />
              <p className="mt-4 text-sm font-bold">Ouverture de la camera...</p>
            </div>
          </div>
        ) : null}

        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-slate-950/80 to-transparent p-4 pt-5">
          <button
            className="w-full rounded-lg bg-white/15 px-4 py-3 text-left backdrop-blur"
            onClick={() => setSiteSheetOpen(true)}
            type="button"
          >
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/70">Photo pour</p>
            <p className="mt-1 truncate text-lg font-black">{selectedSite?.name ?? 'Choisir un chantier'}</p>
          </button>
          {pendingCount > 0 ? (
            <p className="mt-3 rounded-lg bg-orange-500/90 px-3 py-2 text-xs font-bold">
              Synchronisation photo en attente : {pendingCount}
            </p>
          ) : null}
        </div>

        <div className="absolute right-4 top-36 space-y-3">
          <StatusPill label={gpsState.status === 'ready' ? 'GPS' : 'GPS ?'} tone={gpsState.status === 'ready' ? 'success' : 'warning'} />
          {torchSupported ? (
            <IconButton label="Flash" onClick={() => void toggleTorch()} selected={torchEnabled}>
              <FlashIcon className="h-5 w-5" />
            </IconButton>
          ) : null}
          <IconButton
            label="Changer camera"
            onClick={() => setFacingMode((current) => (current === 'environment' ? 'user' : 'environment'))}
          >
            <RotateIcon className="h-5 w-5" />
          </IconButton>
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950 via-slate-950/70 to-transparent p-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          <button
            aria-label="Declencher la photo"
            className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border-4 border-white bg-white/20 disabled:opacity-40"
            disabled={cameraState !== 'ready' || !selectedSite}
            onClick={() => {
              void capturePhoto();
            }}
            type="button"
          >
            <span className="h-16 w-16 rounded-full bg-white" />
          </button>
        </div>

        {siteSheetOpen ? (
          <SiteBottomSheet
            loading={sitesQuery.isLoading}
            onClose={() => setSiteSheetOpen(false)}
            onSelect={(siteId) => {
              setSelectedSiteId(siteId);
              setSiteSheetOpen(false);
            }}
            selectedSiteId={selectedSite?.id ?? ''}
            sites={sites}
          />
        ) : null}
      </div>
    </div>
  );
}

function PhotoConfirmation({
  confirmationMessage,
  onRetry,
  onSend,
  pendingCount,
  photo,
  progress,
  uploading,
}: Readonly<{
  confirmationMessage: string | null;
  onRetry: () => void;
  onSend: () => void;
  pendingCount: number;
  photo: CapturedPhoto;
  progress: number;
  uploading: boolean;
}>) {
  return (
    <div className="-mx-4 -my-4 min-h-[calc(100dvh-10rem)] bg-slate-950 text-white">
      <div className="relative min-h-[calc(100dvh-10rem)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="Apercu photo chantier" className="absolute inset-0 h-full w-full object-cover" src={photo.previewUrl} />
        <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-slate-950/85 to-transparent p-4 pt-5">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-white/70">Confirmation photo</p>
          <h2 className="mt-2 text-2xl font-black">{photo.site.name}</h2>
        </div>
        <div className="absolute inset-x-0 bottom-0 space-y-4 bg-gradient-to-t from-slate-950 via-slate-950/90 to-transparent p-5 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          <div className="rounded-lg bg-white/10 p-4 text-sm backdrop-blur">
            <SummaryRow label="Chantier" value={photo.site.name} />
            <SummaryRow label="Heure" value={formatDateTime(photo.timestampLocal)} />
            <SummaryRow label="GPS" value={photo.latitude === null || photo.longitude === null ? 'Indisponible' : `${photo.latitude.toFixed(5)}, ${photo.longitude.toFixed(5)}`} />
          </div>
          {confirmationMessage ? (
            <div className="rounded-lg bg-orange-500 px-4 py-3 text-sm font-bold text-white">
              {confirmationMessage}
            </div>
          ) : null}
          {pendingCount > 0 ? (
            <p className="rounded-lg bg-orange-500/90 px-3 py-2 text-xs font-bold">
              Synchronisation photo en attente : {pendingCount}
            </p>
          ) : null}
          <div className="space-y-2">
            <button
              className="flex min-h-16 w-full items-center justify-center rounded-lg bg-primary px-5 text-base font-black disabled:opacity-50"
              disabled={uploading || Boolean(confirmationMessage)}
              onClick={onSend}
              type="button"
            >
              {uploading ? `Envoi ${progress}%` : 'Envoyer'}
            </button>
            <div className="h-1 overflow-hidden rounded-full bg-white/20">
              <div className="h-full bg-white transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <button
            className="min-h-14 w-full rounded-lg border border-white/30 px-5 text-sm font-bold text-white"
            disabled={uploading}
            onClick={onRetry}
            type="button"
          >
            Recommencer
          </button>
        </div>
      </div>
    </div>
  );
}

function SiteBottomSheet({
  loading,
  onClose,
  onSelect,
  selectedSiteId,
  sites,
}: Readonly<{
  loading: boolean;
  onClose: () => void;
  onSelect: (siteId: string) => void;
  selectedSiteId: string;
  sites: MobilePhotoSiteOption[];
}>) {
  return (
    <div className="absolute inset-0 z-40 flex items-end bg-slate-950/60">
      <div className="max-h-[75%] w-full overflow-y-auto rounded-t-lg bg-white p-4 text-slate-950">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-black">Choisir un chantier</h2>
          <button className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold" onClick={onClose} type="button">
            Fermer
          </button>
        </div>
        {loading ? <div className="h-20 animate-pulse rounded-lg bg-slate-100" /> : null}
        {!loading && sites.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500">
            Aucun chantier actif accessible.
          </div>
        ) : null}
        <div className="space-y-2">
          {sites.map((site) => (
            <button
              className={`w-full rounded-lg border p-4 text-left ${
                site.id === selectedSiteId ? 'border-primary bg-primary/10' : 'border-slate-200 bg-white'
              }`}
              key={site.id}
              onClick={() => onSelect(site.id)}
              type="button"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-black">{site.name}</p>
                  <p className="mt-1 truncate text-sm text-slate-500">{site.projectName}</p>
                  <p className="mt-1 truncate text-xs text-slate-400">{site.address}</p>
                </div>
                {site.hasOpenSession ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-700">
                    Session
                  </span>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ label, tone }: Readonly<{ label: string; tone: 'success' | 'warning' }>) {
  return (
    <div
      className={`rounded-full px-3 py-2 text-xs font-black ${
        tone === 'success' ? 'bg-emerald-500 text-white' : 'bg-orange-500 text-white'
      }`}
    >
      {label}
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick,
  selected = false,
}: Readonly<{
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  selected?: boolean;
}>) {
  return (
    <button
      aria-label={label}
      className={`flex h-12 w-12 items-center justify-center rounded-full border border-white/20 ${
        selected ? 'bg-white text-slate-950' : 'bg-slate-950/50 text-white'
      }`}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function SummaryRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-white/65">{label}</span>
      <span className="truncate font-bold">{value}</span>
    </div>
  );
}

function toPendingPhoto(photo: CapturedPhoto): PendingMobilePhoto {
  return {
    id: createPendingPhotoId(),
    blob: photo.blob,
    filename: `photo-${photo.timestampLocal.replace(/[:.]/g, '-')}.jpg`,
    siteId: photo.site.id,
    timestampLocal: photo.timestampLocal,
    latitude: photo.latitude,
    longitude: photo.longitude,
  };
}

function uploadPhotoWithProgress(photo: PendingMobilePhoto, onProgress: (value: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/photos');
    request.withCredentials = true;
    const accessToken = getAccessToken();

    if (accessToken) {
      request.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    }

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }

      reject(new Error('Upload photo refuse.'));
    };

    request.onerror = () => reject(new Error('Upload photo impossible.'));
    request.send(buildPhotoFormData(photo));
  });
}

function canUseTorch(stream: MediaStream) {
  const track = stream.getVideoTracks()[0];

  if (!track) {
    return false;
  }

  const capabilities = track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean };
  return Boolean(capabilities?.torch);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
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

function CameraIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <circle cx="12" cy="13.5" r="3.2" stroke="currentColor" strokeWidth="1.8" />
    </>,
  );
}

function FlashIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <path d="M13 2 5 14h6l-1 8 8-12h-6z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />,
  );
}

function RotateIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <path d="M20 12a8 8 0 0 1-13.7 5.7M4 12A8 8 0 0 1 17.7 6.3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M7 18H4v-3M17 6h3v3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </>,
  );
}
