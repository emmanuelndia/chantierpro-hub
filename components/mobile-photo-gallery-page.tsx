'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import { SignedImage } from '@/components/mobile/SignedImage';
import type { MobilePhotoSiteOption, MobilePhotoSitesResponse } from '@/types/mobile-photo';
import type { PaginatedPhotosResponse, PhotoAuthor, PhotoItem } from '@/types/photos';

type MobilePhotoGalleryPageProps = Readonly<{
  initialSiteId: string | null;
  canShowCameraFab: boolean;
}>;

type LightboxState = {
  photoId: string;
  touchStartX: number | null;
};

export function MobilePhotoGalleryPage({ initialSiteId, canShowCameraFab }: MobilePhotoGalleryPageProps) {
  const [siteId, setSiteId] = useState(initialSiteId ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [authorIds, setAuthorIds] = useState<string[]>([]);
  const [siteSheetOpen, setSiteSheetOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const sitesQuery = useQuery({
    queryKey: ['mobile-photo-sites'],
    queryFn: async () => {
      const response = await authFetch('/api/mobile/photo/sites');

      if (!response.ok) {
        throw new Error('Sites photo indisponibles.');
      }

      return (await response.json()) as MobilePhotoSitesResponse;
    },
    staleTime: 300_000,
  });

  const sites = useMemo(() => sitesQuery.data?.items ?? [], [sitesQuery.data?.items]);
  const selectedSite = sites.find((site) => site.id === siteId) ?? sites[0] ?? null;

  useEffect(() => {
    if (!siteId && selectedSite) {
      setSiteId(selectedSite.id);
    }
  }, [selectedSite, siteId]);

  const photosQuery = useInfiniteQuery({
    queryKey: ['mobile-gallery-photos', selectedSite?.id ?? '', from, to, authorIds],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      if (!selectedSite) {
        return emptyPhotoPage(pageParam);
      }

      const searchParams = new URLSearchParams({
        page: String(pageParam),
        sort: 'desc',
      });

      if (from) {
        searchParams.set('from', from);
      }

      if (to) {
        searchParams.set('to', to);
      }

      if (authorIds.length > 0) {
        searchParams.set('uploadedBy', authorIds.join(','));
      }

      const response = await authFetch(`/api/sites/${selectedSite.id}/photos?${searchParams.toString()}`);

      if (!response.ok) {
        throw new Error(`Photos request failed with status ${response.status}`);
      }

      return (await response.json()) as PaginatedPhotosResponse;
    },
    staleTime: 30_000,
    getNextPageParam: (lastPage) => (lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined),
    enabled: Boolean(selectedSite),
  });

  const pages = useMemo(() => photosQuery.data?.pages ?? [], [photosQuery.data?.pages]);
  const photos = useMemo(() => pages.flatMap((page) => page.items), [pages]);
  const authors = useMemo(() => mergeAuthors(pages), [pages]);
  const activePhoto = lightbox ? photos.find((photo) => photo.id === lightbox.photoId) ?? null : null;
  const totalItems = pages[0]?.totalItems ?? 0;

  useEffect(() => {
    const sentinel = sentinelRef.current;

    if (!sentinel) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && photosQuery.hasNextPage && !photosQuery.isFetchingNextPage) {
        void photosQuery.fetchNextPage();
      }
    });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [photosQuery]);

  function resetFilters() {
    setFrom('');
    setTo('');
    setAuthorIds([]);
  }

  function moveLightbox(delta: number) {
    setLightbox((current) => {
      if (!current || photos.length === 0) {
        return current;
      }

      const currentIndex = photos.findIndex((photo) => photo.id === current.photoId);
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + delta + photos.length) % photos.length;
      return {
        photoId: photos[nextIndex]?.id ?? current.photoId,
        touchStartX: null,
      };
    });
  }

  return (
    <div className="space-y-5 pb-8">
      <section className="rounded-lg border border-primary/20 bg-white p-4 shadow-panel">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Galerie photos</p>
            <p className="mt-1 text-sm font-semibold text-slate-500">
              {photosQuery.isLoading || sitesQuery.isLoading ? 'Chargement' : `${totalItems} photo${totalItems > 1 ? 's' : ''}`}
            </p>
          </div>
          <button
            className="min-h-11 shrink-0 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700"
            onClick={() => setFiltersOpen((current) => !current)}
            type="button"
          >
            Filtres
          </button>
        </div>
        <button
          className="mt-4 w-full rounded-lg bg-primary/10 p-3 text-left"
          onClick={() => setSiteSheetOpen(true)}
          type="button"
        >
          <h2 className="truncate text-2xl font-black text-slate-950">
            {selectedSite?.name ?? 'Choisir un chantier'}
          </h2>
          <p className="mt-1 truncate text-sm text-slate-600">
            {selectedSite?.projectName ?? 'Photos chantier'}
          </p>
        </button>
      </section>

      <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-bold text-orange-800">
        Suppression disponible sur l&apos;application web
      </div>

      {filtersOpen ? (
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
          <div className="grid grid-cols-2 gap-3">
            <DateField label="Du" onChange={setFrom} value={from} />
            <DateField label="Au" onChange={setTo} value={to} />
          </div>
          <AuthorMultiSelect authors={authors} selectedIds={authorIds} setSelectedIds={setAuthorIds} />
          <button
            className="min-h-12 w-full rounded-lg border border-slate-300 px-4 text-sm font-bold text-slate-700"
            onClick={resetFilters}
            type="button"
          >
            Réinitialiser
          </button>
        </section>
      ) : null}

      {photosQuery.isLoading || sitesQuery.isLoading ? <LoadingGrid /> : null}

      {photosQuery.isError || sitesQuery.isError ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          Impossible de charger la galerie.
        </section>
      ) : null}

      {!photosQuery.isLoading && photos.length === 0 ? (
        <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
          <h3 className="text-lg font-black text-slate-950">Aucune photo</h3>
          <p className="mt-2 text-sm text-slate-500">Aucune photo ne correspond aux filtres.</p>
        </section>
      ) : null}

      {photos.length > 0 ? (
        <section className="grid grid-cols-2 gap-3">
          {photos.map((photo) => (
            <PhotoTile key={photo.id} onOpen={() => setLightbox({ photoId: photo.id, touchStartX: null })} photo={photo} />
          ))}
        </section>
      ) : null}

      <div ref={sentinelRef} className="h-8" />

      {photosQuery.isFetchingNextPage ? (
        <p className="text-center text-sm font-semibold text-slate-500">Chargement...</p>
      ) : null}

      {siteSheetOpen ? (
        <SiteSheet
          loading={sitesQuery.isLoading}
          onClose={() => setSiteSheetOpen(false)}
          onSelect={(nextSiteId) => {
            setSiteId(nextSiteId);
            setAuthorIds([]);
            setSiteSheetOpen(false);
          }}
          selectedSiteId={selectedSite?.id ?? ''}
          sites={sites}
        />
      ) : null}

      {activePhoto ? (
        <GalleryLightbox
          lightbox={lightbox}
          move={moveLightbox}
          onClose={() => setLightbox(null)}
          photo={activePhoto}
          setLightbox={setLightbox}
        />
      ) : null}

      {canShowCameraFab ? (
        <a
          href="/mobile/camera-management"
          className="fixed right-4 z-40 flex min-h-14 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-white shadow-xl shadow-slate-900/20 transition active:scale-[0.98]"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5rem)' }}
        >
          <CameraIcon className="h-5 w-5" />
          Prendre une photo
        </a>
      ) : null}
    </div>
  );
}

function DateField({
  label,
  onChange,
  value,
}: Readonly<{ label: string; onChange: (value: string) => void; value: string }>) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{label}</span>
      <input
        className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 outline-none focus:border-primary"
        onChange={(event) => onChange(event.target.value)}
        type="date"
        value={value}
      />
    </label>
  );
}

function AuthorMultiSelect({
  authors,
  selectedIds,
  setSelectedIds,
}: Readonly<{
  authors: PhotoAuthor[];
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
}>) {
  if (authors.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm font-semibold text-slate-500">
        Aucun auteur disponible.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Auteurs</p>
      <div className="flex flex-wrap gap-2">
        {authors.map((author) => {
          const selected = selectedIds.includes(author.id);
          return (
            <button
              className={`rounded-full border px-3 py-2 text-xs font-bold ${
                selected ? 'border-primary bg-primary text-white' : 'border-slate-200 bg-white text-slate-600'
              }`}
              key={author.id}
              onClick={() => {
                setSelectedIds(
                  selected
                    ? selectedIds.filter((id) => id !== author.id)
                    : [...selectedIds, author.id],
                );
              }}
            type="button"
            >
              {author.firstName} {author.lastName}
          </button>
          );
        })}
      </div>
    </div>
  );
}

function PhotoTile({ onOpen, photo }: Readonly<{ onOpen: () => void; photo: PhotoItem }>) {
  return (
    <button
      className="group overflow-hidden rounded-lg border border-slate-200 bg-slate-100 text-left shadow-panel"
      onClick={onOpen}
      type="button"
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-slate-100">
        <SignedImage
          photoId={photo.id}
          alt={photo.description || photo.filename}
          className="object-cover"
          fill
          sizes="50vw"
        />
      </div>
      <div className="p-3">
        <p className="truncate text-sm font-black text-slate-950">{formatAuthor(photo)}</p>
        <p className="mt-1 text-xs font-semibold text-slate-500">{formatDateTime(photo.timestampLocal)}</p>
      </div>
    </button>
  );
}

function SiteSheet({
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
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/60">
      <div className="max-h-[75dvh] w-full overflow-y-auto rounded-t-lg bg-white p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-slate-950">Choisir un chantier</h2>
          <button className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700" onClick={onClose} type="button">
            Fermer
          </button>
        </div>
        {loading ? <div className="h-20 animate-pulse rounded-lg bg-slate-100" /> : null}
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
              <p className="truncate text-base font-black text-slate-950">{site.name}</p>
              <p className="mt-1 truncate text-sm text-slate-500">{site.projectName}</p>
          </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function GalleryLightbox({
  lightbox,
  move,
  onClose,
  photo,
  setLightbox,
}: Readonly<{
  lightbox: LightboxState | null;
  move: (delta: number) => void;
  onClose: () => void;
  photo: PhotoItem;
  setLightbox: Dispatch<SetStateAction<LightboxState | null>>;
}>) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white"
      onTouchEnd={(event) => {
        if (lightbox?.touchStartX === null || lightbox?.touchStartX === undefined) {
          return;
        }

        const delta = event.changedTouches[0]?.clientX ?? lightbox.touchStartX;
        const movement = delta - lightbox.touchStartX;

        if (Math.abs(movement) > 48) {
          move(movement > 0 ? -1 : 1);
        }
      }}
      onTouchStart={(event) => {
        const touch = event.touches[0];
        if (!touch) {
          return;
        }

        setLightbox((current) => current ? { ...current, touchStartX: touch.clientX } : current);
      }}
    >
      <header className="flex items-center justify-between gap-3 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <button className="rounded-lg border border-white/20 px-3 py-2 text-sm font-bold" onClick={onClose} type="button">
          Fermer
        </button>
        <div className="min-w-0 text-right">
          <p className="truncate text-sm font-black">{formatAuthor(photo)}</p>
          <p className="text-xs text-white/60">{formatDateTime(photo.timestampLocal)} - {photo.siteName ?? 'Chantier'}</p>
        </div>
      </header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        <button
          aria-label="Photo précédente"
          className="absolute left-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl font-black"
          onClick={() => move(-1)}
          type="button"
        >
          {'<'}
        </button>
        <div className="relative h-full w-full">
          <SignedImage
            photoId={photo.id}
            alt={photo.description || photo.filename}
            className="object-contain"
            fill
            sizes="100vw"
          />
        </div>
        <button
          aria-label="Photo suivante"
          className="absolute right-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-2xl font-black"
          onClick={() => move(1)}
          type="button"
        >
          {'>'}
        </button>
      </div>
      <footer className="space-y-2 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-center">
        <p className="text-sm font-semibold text-white/80">Suppression disponible sur l&apos;application web</p>
      </footer>
    </div>
  );
}

function LoadingGrid() {
  return (
    <section className="grid grid-cols-2 gap-3">
      <div className="h-56 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-56 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-56 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-56 animate-pulse rounded-lg bg-slate-100" />
    </section>
  );
}

function emptyPhotoPage(page: number): PaginatedPhotosResponse {
  return {
    items: [],
    page,
    pageSize: 20,
    totalItems: 0,
    totalPages: 1,
    authors: [],
    sites: [],
  };
}

function mergeAuthors(pages: PaginatedPhotosResponse[]) {
  const authors = new Map<string, PhotoAuthor>();

  for (const page of pages) {
    for (const author of page.authors) {
      authors.set(author.id, author);
    }
  }

  return [...authors.values()];
}

function formatAuthor(photo: PhotoItem) {
  return `${photo.author.firstName} ${photo.author.lastName}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function CameraIcon({ className }: Readonly<{ className: string }>) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}
