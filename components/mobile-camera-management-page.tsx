'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useGeolocation } from '@/lib/hooks/useGeolocation';
import type { MobilePhotoSiteOption, MobilePhotoSitesResponse } from '@/types/mobile-photo';

type CameraState = 'loading' | 'ready' | 'denied';
type FacingMode = 'environment' | 'user';

type CapturedPhoto = {
  blob: Blob;
  previewUrl: string;
  timestampLocal: string;
  latitude: number | null;
  longitude: number | null;
  site: MobilePhotoSiteOption;
};

export function MobileCameraManagementPage() {
  const searchParams = useSearchParams();
  const requestedSiteId = searchParams.get('siteId');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>('loading');
  const [cameraMessage, setCameraMessage] = useState('');
  const [facingMode, setFacingMode] = useState<FacingMode>('environment');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [selectedSiteId, setSelectedSiteId] = useState(requestedSiteId ?? '');
  const [siteSheetOpen, setSiteSheetOpen] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<CapturedPhoto | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  // Utiliser le hook de géolocalisation amélioré
  const geolocation = useGeolocation({
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 0,
  });

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
        latitude: geolocation.latitude,
        longitude: geolocation.longitude,
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
      setConfirmationMessage('Photo envoyée.');
      setCapturedPhoto(null);
      await refreshPendingCount();
    } catch {
      await enqueuePendingMobilePhoto(pendingPhoto);
      await refreshPendingCount();
      setConfirmationMessage('Photo stockée hors ligne, synchronisation au retour réseau.');
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
          {cameraMessage || 'Autorisez la caméra dans les réglages du navigateur puis réessayez.'}
        </p>
        <button
          className="mt-6 min-h-14 rounded-lg bg-orange-600 px-5 text-sm font-bold text-white"
          onClick={() => {
            void startCamera();
          }}
          type="button"
        >
          Réessayer
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
              <p className="mt-4 text-sm font-bold">Ouverture de la caméra...</p>
            </div>
          </div>
        ) : null}

        {/* Header management */}
        <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/30 to-transparent p-4 pt-5">
          <div className="flex justify-between items-center">
            <button 
              className="text-white/90 text-sm font-medium flex items-center gap-1 backdrop-blur-sm bg-black/20 px-3 py-2 rounded-full"
              onClick={() => window.history.back()}
            >
              <ChevronLeftIcon className="w-4 h-4" />
            </button>
            <div className="text-white/80 text-xs font-medium backdrop-blur-sm bg-black/20 px-2 py-1 rounded-lg">
              Chef de projet
            </div>
          </div>
        </div>

        {/* Overlay d'informations chantier */}
        <div className="absolute top-16 left-4 right-4">
          <div className="bg-black/60 backdrop-blur-sm rounded-lg p-3 mb-3">
            <div className="text-white text-sm font-semibold mb-1">
              {selectedSite?.name ?? 'Choisir un chantier'}
            </div>
            <div className="text-white/80 text-xs">
              {selectedSite?.projectName}
            </div>
            <div className="flex gap-2 mt-2">
              <span className="bg-blue-500 text-white text-xs px-2 py-1 rounded">
                {selectedSite?.address}
              </span>
              {geolocation.latitude && geolocation.longitude && (
                <span className="text-white/60 text-xs">
                  {geolocation.latitude.toFixed(4)}, {geolocation.longitude.toFixed(4)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="absolute right-4 top-36 space-y-3">
          <StatusPill 
            label={geolocation.loading ? 'GPS ?' : geolocation.error ? 'GPS !' : 'GPS'} 
            tone={geolocation.loading ? 'warning' : geolocation.error ? 'warning' : 'success'} 
          />
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
            aria-label="Déclencher la photo"
            className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border-4 border-white bg-white/20 disabled:opacity-40"
            disabled={cameraState !== 'ready' || !selectedSite}
            onClick={() => {
              void capturePhoto();
            }}
            type="button"
          >
            <CameraIcon className="h-10 w-10 text-white" />
          </button>
        </div>

        {siteSheetOpen && (
          <SiteBottomSheet
            loading={sitesQuery.isLoading}
            onClose={() => setSiteSheetOpen(false)}
            onSelect={(siteId) => {
              setSelectedSiteId(siteId);
              setSiteSheetOpen(false);
            }}
            selectedSiteId={selectedSiteId}
            sites={sites}
          />
        )}
      </div>
    </div>
  );
}

// Composants utilitaires (identiques à MobilePhotoCameraPage)
function PhotoConfirmation({
  confirmationMessage,
  onRetry,
  onSend,
  photo,
  pendingCount,
  progress,
  uploading,
}: Readonly<{
  confirmationMessage: string | null;
  onRetry: () => void;
  onSend: () => void;
  photo: CapturedPhoto;
  pendingCount: number;
  progress: number;
  uploading: boolean;
}>) {
  return (
    <div className="relative min-h-[calc(100dvh-10rem)]">
      <div className="relative h-full">
        <img
          alt="Photo capturée"
          className="h-full w-full object-cover"
          src={photo.previewUrl}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/50 via-slate-950/30 to-slate-950" />
        <div className="absolute inset-x-0 top-0 p-4 pt-5">
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

// Fonctions utilitaires (à importer de MobilePhotoCameraPage ou recréer)
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

      reject(new Error('Upload photo refusé.'));
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

  const capabilities = track.getCapabilities();

  return capabilities.torch ? true : false;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
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

// Icônes (à importer ou remplacer)
function CameraIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function FlashIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  );
}

function RotateIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function ChevronLeftIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function Spinner({ className }: { className: string }) {
  return (
    <svg aria-hidden="true" className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="m4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}
