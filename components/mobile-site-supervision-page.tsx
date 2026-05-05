'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import { SignedImage } from '@/components/mobile/SignedImage';
import { haversineDistanceKm } from '@/lib/haversine';
import type {
  MobileSitePhotoItem,
  MobileSitePresenceItem,
  MobileSiteSupervisionResponse,
} from '@/types/mobile-site-supervision';

type MobileSiteSupervisionPageProps = Readonly<{
  siteId: string;
}>;

type TabId = 'presence' | 'photos' | 'reports';

type GeoState =
  | { status: 'loading' }
  | { status: 'ready'; latitude: number; longitude: number }
  | { status: 'unavailable' };

export function MobileSiteSupervisionPage({ siteId }: MobileSiteSupervisionPageProps) {
  const [activeTab, setActiveTab] = useState<TabId>('presence');
  const [activePhoto, setActivePhoto] = useState<MobileSitePhotoItem | null>(null);
  const geoState = useCurrentPosition();

  const supervisionQuery = useQuery({
    queryKey: ['mobile-site-supervision', siteId],
    queryFn: async () => {
      const response = await authFetch(`/api/mobile/sites/${siteId}/supervision`);

      if (!response.ok) {
        throw new Error(`Mobile site supervision failed with status ${response.status}`);
      }

      return (await response.json()) as MobileSiteSupervisionResponse;
    },
    refetchInterval: 45_000,
    staleTime: 30_000,
  });

  const data = supervisionQuery.data;
  const distanceKm = useMemo(() => {
    if (!data || geoState.status !== 'ready') {
      return null;
    }

    return haversineDistanceKm(
      { latitude: geoState.latitude, longitude: geoState.longitude },
      { latitude: data.site.latitude, longitude: data.site.longitude },
    );
  }, [data, geoState]);

  if (supervisionQuery.isLoading) {
    return <LoadingState />;
  }

  if (supervisionQuery.isError || !data) {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
        Impossible de charger ce chantier.
      </section>
    );
  }

  return (
    <div className="space-y-5 pb-20">
      <section className="rounded-lg border border-primary/20 bg-primary/10 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
              {data.site.projectName}
            </p>
            <h2 className="mt-2 text-2xl font-black text-slate-950">{data.site.name}</h2>
            <p className="mt-2 text-sm leading-5 text-slate-600">{data.site.address}</p>
          </div>
          <span className="shrink-0 rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-700">
            {formatSiteStatus(data.site.status)}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <MetricTile label="Distance" value={distanceKm === null ? 'Indisponible' : `${distanceKm.toFixed(2)} km`} />
          <MetricTile label="Rayon" value={`${data.site.radiusKm} km`} />
        </div>
      </section>

      <nav className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
        <TabButton active={activeTab === 'presence'} label="Presences" onClick={() => setActiveTab('presence')} />
        <TabButton active={activeTab === 'photos'} label="Photos" onClick={() => setActiveTab('photos')} />
        <TabButton active={activeTab === 'reports'} label="Rapports" onClick={() => setActiveTab('reports')} />
      </nav>

      {activeTab === 'presence' ? <PresenceTab items={data.presence.items} /> : null}
      {activeTab === 'photos' ? <PhotosTab onOpen={setActivePhoto} photos={data.photos} siteId={siteId} /> : null}
      {activeTab === 'reports' ? <ReportsTab reports={data.reports} /> : null}

      <Link
        className="fixed right-4 z-40 flex min-h-14 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-bold text-white shadow-xl shadow-slate-900/20 transition active:scale-[0.98]"
        href={`/mobile/photo?siteId=${encodeURIComponent(siteId)}`}
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5.5rem)' }}
      >
        <CameraIcon className="h-5 w-5" />
        Prendre une photo
      </Link>

      {activePhoto ? <PhotoLightbox onClose={() => setActivePhoto(null)} photo={activePhoto} /> : null}
    </div>
  );
}

function PresenceTab({ items }: Readonly<{ items: MobileSitePresenceItem[] }>) {
  if (items.length === 0) {
    return <EmptyPanel text="Aucune ressource active sur ce chantier." />;
  }

  return (
    <section className="space-y-3">
      {items.map((item) => (
        <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel" key={item.userId}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-base font-black text-slate-950">{item.name}</h3>
              <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                {item.role.replaceAll('_', ' ')}
              </p>
            </div>
            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${presenceTone(item.status)}`}>
              {formatPresenceStatus(item)}
            </span>
          </div>
          <p className="mt-3 text-sm font-semibold text-slate-500">
            Dernier pointage : {item.lastClockInAt ? formatTime(item.lastClockInAt) : 'Aucun'}
          </p>
        </article>
      ))}
    </section>
  );
}

function PhotosTab({
  onOpen,
  photos,
  siteId,
}: Readonly<{
  onOpen: (photo: MobileSitePhotoItem) => void;
  photos: MobileSitePhotoItem[];
  siteId: string;
}>) {
  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-bold text-orange-800">
        Suppression disponible sur l&apos;application web
      </div>
      <Link
        className="flex min-h-12 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-black text-slate-700"
        href={`/mobile/gallery?siteId=${encodeURIComponent(siteId)}`}
      >
        Voir la galerie
      </Link>
      {photos.length === 0 ? (
        <EmptyPanel text="Aucune photo recente sur ce chantier." />
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <button
              className="relative aspect-square overflow-hidden rounded-lg bg-slate-100"
              key={photo.id}
              onClick={() => onOpen(photo)}
              type="button"
            >
              <SignedImage
                photoId={photo.id}
                alt={photo.filename}
                className="object-cover"
                fill
                sizes="33vw"
              />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function ReportsTab({ reports }: Readonly<{ reports: MobileSiteSupervisionResponse['reports'] }>) {
  if (reports.length === 0) {
    return <EmptyPanel text="Aucun rapport soumis sur ce chantier." />;
  }

  return (
    <section className="space-y-3">
      {reports.map((report) => (
        <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel" key={report.id}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="truncate text-sm font-black text-slate-950">{report.authorName}</h3>
            <span className="shrink-0 text-xs font-bold text-slate-400">{formatDateTime(report.submittedAt)}</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-600">{report.content}</p>
        </article>
      ))}
    </section>
  );
}

function PhotoLightbox({
  onClose,
  photo,
}: Readonly<{
  onClose: () => void;
  photo: MobileSitePhotoItem;
}>) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white">
      <header className="flex items-center justify-between gap-3 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <div className="min-w-0">
          <p className="truncate text-sm font-black">{photo.uploadedByName}</p>
          <p className="text-xs text-white/60">{formatDateTime(photo.timestampLocal)}</p>
        </div>
        <button className="rounded-lg border border-white/20 px-3 py-2 text-sm font-bold" onClick={onClose} type="button">
          Fermer
        </button>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <div className="relative h-full w-full">
          <SignedImage
            photoId={photo.id}
            alt={photo.filename}
            className="object-contain"
            fill
            sizes="100vw"
          />
        </div>
      </div>
      <footer className="px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-center text-sm font-semibold text-white/70">
        Suppression disponible sur l&apos;application web
      </footer>
    </div>
  );
}

function TabButton({
  active,
  label,
  onClick,
}: Readonly<{ active: boolean; label: string; onClick: () => void }>) {
  return (
    <button
      className={`min-h-12 rounded-lg text-sm font-black ${active ? 'bg-white text-primary shadow-sm' : 'text-slate-500'}`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function MetricTile({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-lg bg-white/80 p-3">
      <div className="truncate text-base font-black text-slate-950">{value}</div>
      <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </div>
    </div>
  );
}

function EmptyPanel({ text }: Readonly<{ text: string }>) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm font-semibold text-slate-500">
      {text}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <div className="h-40 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-12 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
    </div>
  );
}

function useCurrentPosition(): GeoState {
  const [geoState, setGeoState] = useState<GeoState>({ status: 'loading' });

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoState({ status: 'unavailable' });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoState({
          status: 'ready',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => setGeoState({ status: 'unavailable' }),
      {
        enableHighAccuracy: true,
        maximumAge: 60_000,
        timeout: 10_000,
      },
    );
  }, []);

  return geoState;
}

function formatPresenceStatus(item: MobileSitePresenceItem) {
  if (item.status === 'PAUSED') {
    return 'En pause';
  }

  if (item.status === 'PRESENT') {
    return item.presentSince ? `Present depuis ${formatShortDurationSince(item.presentSince)}` : 'Present';
  }

  return 'Absent';
}

function presenceTone(status: MobileSitePresenceItem['status']) {
  if (status === 'PRESENT') {
    return 'bg-emerald-100 text-emerald-700';
  }

  if (status === 'PAUSED') {
    return 'bg-orange-100 text-orange-700';
  }

  return 'bg-slate-100 text-slate-500';
}

function formatSiteStatus(status: string) {
  if (status === 'ACTIVE') {
    return 'Actif';
  }

  return status.replaceAll('_', ' ').toLowerCase();
}

function formatShortDurationSince(value: string) {
  const totalMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h${minutes.toString().padStart(2, '0')}`;
  }

  return `${minutes}min`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function baseIcon(className: string, children: React.ReactNode) {
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
