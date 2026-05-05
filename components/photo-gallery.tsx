'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PhotoCategory, type Role } from '@prisma/client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import type { PaginatedPhotosResponse, PhotoDetail, PhotoItem, PhotoSiteOption } from '@/types/photos';

type PhotoGalleryProps = Readonly<{
  scope:
    | {
        type: 'site';
        siteId: string;
        siteName?: string;
      }
    | {
        type: 'project';
        projectId: string;
        sites?: PhotoSiteOption[];
      };
  viewer: {
    id: string;
    role: Role;
  };
  title?: string;
  description?: string;
}>;

const DELETE_ROLES: readonly Role[] = ['PROJECT_MANAGER', 'DIRECTION', 'ADMIN'];
const UPLOAD_ROLES: readonly Role[] = [
  'SUPERVISOR',
  'COORDINATOR',
  'GENERAL_SUPERVISOR',
  'PROJECT_MANAGER',
  'DIRECTION',
  'ADMIN',
];

export function PhotoGallery({ scope, viewer, title = 'Galerie photos', description }: PhotoGalleryProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [authorIds, setAuthorIds] = useState<string[]>([]);
  const [sort, setSort] = useState<'asc' | 'desc'>('desc');
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PhotoItem | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [captureOpen, setCaptureOpen] = useState(false);

  const queryKey = useMemo(
    () => ['photo-gallery', scope.type, scope.type === 'site' ? scope.siteId : scope.projectId, page, from, to, authorIds, sort],
    [authorIds, from, page, scope, sort, to],
  );

  const photosQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      searchParams.set('page', String(page));
      searchParams.set('sort', sort);
      if (from) {
        searchParams.set('from', `${from}T00:00:00.000Z`);
      }
      if (to) {
        searchParams.set('to', `${to}T23:59:59.999Z`);
      }
      if (authorIds.length > 0) {
        searchParams.set('uploadedBy', authorIds.join(','));
      }

      const endpoint =
        scope.type === 'site'
          ? `/api/sites/${scope.siteId}/photos?${searchParams.toString()}`
          : `/api/projects/${scope.projectId}/photos?${searchParams.toString()}`;
      const response = await authFetch(endpoint, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Photos request failed with status ${response.status}`);
      }

      return (await response.json()) as PaginatedPhotosResponse;
    },
    gcTime: 0,
    refetchOnMount: 'always',
    staleTime: 30_000,
  });

  const detailQuery = useQuery({
    queryKey: ['photo-detail', activePhotoId],
    queryFn: async () => {
      const response = await authFetch(`/api/photos/${activePhotoId}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Photo detail request failed with status ${response.status}`);
      }

      return ((await response.json()) as { photo: PhotoDetail }).photo;
    },
    enabled: Boolean(activePhotoId),
    gcTime: 0,
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) {
        return;
      }

      const response = await authFetch(`/api/photos/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: deleteReason.trim() }),
      });

      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Suppression impossible.');
      }
    },
    onSuccess: () => {
      setDeleteTarget(null);
      setDeleteReason('');
      setActivePhotoId(null);
      void queryClient.invalidateQueries({ queryKey: ['photo-gallery'] });
      pushToast({ type: 'success', title: 'Photo supprimee' });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Suppression impossible',
        message: error instanceof Error ? error.message : "La photo n'a pas pu etre supprimee.",
      });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (payload: UploadPayload) => {
      const formData = new FormData();
      formData.set('file', payload.file);
      formData.set('siteId', payload.siteId);
      formData.set('category', payload.category);
      formData.set('description', payload.description);
      formData.set('timestampLocal', payload.timestampLocal);
      if (payload.latitude !== null) {
        formData.set('lat', String(payload.latitude));
      }
      if (payload.longitude !== null) {
        formData.set('lng', String(payload.longitude));
      }

      const response = await authFetch('/api/photos', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Upload impossible.');
      }
    },
    onSuccess: () => {
      setCaptureOpen(false);
      setPage(1);
      void queryClient.invalidateQueries({ queryKey: ['photo-gallery'] });
      pushToast({ type: 'success', title: 'Photo ajoutee' });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Upload impossible',
        message: error instanceof Error ? error.message : "La photo n'a pas pu etre envoyee.",
      });
    },
  });

  const photos = useMemo(() => photosQuery.data?.items ?? [], [photosQuery.data?.items]);
  const activePhoto = detailQuery.data ?? photos.find((photo) => photo.id === activePhotoId) ?? null;
  const canDelete = DELETE_ROLES.includes(viewer.role);
  const canUpload = UPLOAD_ROLES.includes(viewer.role);
  const uploadSites = useMemo(() => {
    const fromResponse = photosQuery.data?.sites ?? [];
    const fromProps = scope.type === 'project' ? (scope.sites ?? []) : [{ id: scope.siteId, name: scope.siteName ?? 'Chantier' }];
    const merged = new Map<string, PhotoSiteOption>();

    for (const site of [...fromProps, ...fromResponse]) {
      merged.set(site.id, site);
    }

    return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [photosQuery.data?.sites, scope]);

  const activeIndex = photos.findIndex((photo) => photo.id === activePhotoId);
  const defaultUploadSiteId = scope.type === 'site' ? scope.siteId : uploadSites[0]?.id;

  useEffect(() => {
    if (!activePhotoId) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setActivePhotoId(null);
      }
      if (event.key === 'ArrowRight') {
        setActivePhotoId((current) => getRelativePhotoId(photos, current, 1));
      }
      if (event.key === 'ArrowLeft') {
        setActivePhotoId((current) => getRelativePhotoId(photos, current, -1));
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePhotoId, photos]);

  function resetPage() {
    setPage(1);
  }

  async function handleDownload(photo: PhotoItem) {
    try {
      const response = await fetch(getPhotoContentUrl(photo.id), { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Download failed with status ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = buildDownloadFileName(photo);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      pushToast({
        type: 'error',
        title: 'Telechargement impossible',
        message: error instanceof Error ? error.message : "La photo n'a pas pu etre telechargee.",
      });
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Photos chantier</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
            {description ? <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{description}</p> : null}
          </div>
          {canUpload ? (
            <button
              className="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              onClick={() => setCaptureOpen(true)}
              type="button"
            >
              Ajouter une photo
            </button>
          ) : null}
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
        <div className="grid gap-4 lg:grid-cols-[0.8fr_0.8fr_1.2fr_0.8fr]">
          <Field label="Periode du">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setFrom(event.target.value);
                resetPage();
              }}
              type="date"
              value={from}
            />
          </Field>
          <Field label="Au">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setTo(event.target.value);
                resetPage();
              }}
              type="date"
              value={to}
            />
          </Field>
          <Field label="Auteurs">
            <select
              className="min-h-28 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              multiple
              onChange={(event) => {
                setAuthorIds([...event.target.selectedOptions].map((option) => option.value));
                resetPage();
              }}
              value={authorIds}
            >
              {(photosQuery.data?.authors ?? []).map((author) => (
                <option key={author.id} value={author.id}>
                  {author.firstName} {author.lastName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ordre">
            <select
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setSort(event.target.value as 'asc' | 'desc');
                resetPage();
              }}
              value={sort}
            >
              <option value="desc">Anti-chrono</option>
              <option value="asc">Chrono</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
        {photosQuery.isLoading ? <LoadingGrid /> : null}
        {photosQuery.isError ? (
          <EmptyState description="Les photos ne peuvent pas etre chargees pour le moment." title="Galerie indisponible" />
        ) : null}
        {!photosQuery.isLoading && photosQuery.data && photos.length === 0 ? (
          <EmptyState description="Aucune photo ne correspond a ces filtres." title="Aucune photo" />
        ) : null}
        {photos.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {photos.map((photo) => (
              <PhotoTile
                key={photo.id}
                {...(canDelete ? { onDelete: () => setDeleteTarget(photo) } : {})}
                onDownload={() => void handleDownload(photo)}
                onOpen={() => setActivePhotoId(photo.id)}
                photo={photo}
              />
            ))}
          </div>
        ) : null}
        {photosQuery.data ? (
          <PaginationBar
            onNext={() => setPage((current) => current + 1)}
            onPrevious={() => setPage((current) => Math.max(1, current - 1))}
            page={photosQuery.data.page}
            totalItems={photosQuery.data.totalItems}
            totalPages={photosQuery.data.totalPages}
          />
        ) : null}
      </section>

      {activePhotoId ? (
        <Lightbox
          canDelete={canDelete}
          loading={detailQuery.isLoading}
          onClose={() => setActivePhotoId(null)}
          {...(activePhoto ? { onDelete: () => setDeleteTarget(activePhoto), onDownload: () => void handleDownload(activePhoto) } : {})}
          onNext={() => setActivePhotoId((current) => getRelativePhotoId(photos, current, 1))}
          onPrevious={() => setActivePhotoId((current) => getRelativePhotoId(photos, current, -1))}
          photo={activePhoto}
          position={activeIndex >= 0 ? `${activeIndex + 1} / ${photos.length}` : ''}
        />
      ) : null}

      <DeletePhotoModal
        onClose={() => {
          setDeleteTarget(null);
          setDeleteReason('');
        }}
        onConfirm={() => deleteMutation.mutate()}
        open={Boolean(deleteTarget)}
        pending={deleteMutation.isPending}
        reason={deleteReason}
        setReason={setDeleteReason}
      />

      {captureOpen ? (
        <PhotoCaptureModal
          {...(defaultUploadSiteId ? { defaultSiteId: defaultUploadSiteId } : {})}
          onClose={() => setCaptureOpen(false)}
          onSubmit={(payload) => uploadMutation.mutate(payload)}
          pending={uploadMutation.isPending}
          sites={uploadSites}
        />
      ) : null}
    </div>
  );
}

function PhotoTile({
  photo,
  onOpen,
  onDownload,
  onDelete,
}: Readonly<{
  photo: PhotoItem;
  onOpen: () => void;
  onDownload: () => void;
  onDelete?: () => void;
}>) {
  return (
    <article className="group overflow-hidden rounded-3xl border border-slate-200 bg-white">
      <button className="relative block aspect-[4/3] w-full overflow-hidden bg-slate-100 text-left" onClick={onOpen} type="button">
        <Image
          alt={photo.description || photo.filename}
          className="object-cover transition duration-500 group-hover:scale-105"
          fill
          sizes="(min-width: 1024px) 33vw, 100vw"
          src={getPhotoContentUrl(photo.id)}
          unoptimized
        />
        <div className="absolute inset-0 flex items-end bg-gradient-to-t from-slate-950/85 via-slate-950/20 to-transparent p-4 opacity-0 transition group-hover:opacity-100">
          <div className="space-y-1 text-white">
            <p className="text-sm font-semibold">{formatAuthor(photo)}</p>
            <p className="text-xs text-white/85">{formatDateTime(photo.timestampLocal)}</p>
            <p className="text-xs text-white/85">GPS {formatGps(photo)}</p>
          </div>
        </div>
      </button>
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-sm font-semibold text-slate-950">{photo.description || photo.filename}</p>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{photo.category}</span>
        </div>
        <p className="text-xs uppercase tracking-[0.16em] text-slate-400">{photo.siteName ?? formatDateOnly(photo.timestampLocal)}</p>
        <div className="flex flex-wrap gap-2">
          <button className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50" onClick={onDownload} type="button">
            Telecharger
          </button>
          {onDelete ? (
            <button className="rounded-full border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100" onClick={onDelete} type="button">
              Supprimer
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function Lightbox({
  photo,
  loading,
  position,
  canDelete,
  onClose,
  onPrevious,
  onNext,
  onDownload,
  onDelete,
}: Readonly<{
  photo: PhotoItem | null;
  loading: boolean;
  position: string;
  canDelete: boolean;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
}>) {
  return (
    <div className="fixed inset-0 z-[80] flex bg-slate-950/95 text-white">
      <div className="flex flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <p className="text-sm font-semibold">{position}</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {onDownload ? (
              <button className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold transition hover:bg-white/10" onClick={onDownload} type="button">
                Telecharger
              </button>
            ) : null}
            {canDelete && onDelete ? (
              <button className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold transition hover:bg-red-700" onClick={onDelete} type="button">
                Supprimer
              </button>
            ) : null}
            <button className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold transition hover:bg-white/10" onClick={onClose} type="button">
              Fermer
            </button>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 lg:grid-cols-[80px_1fr_80px]">
          <button className="hidden text-4xl transition hover:bg-white/10 lg:block" onClick={onPrevious} type="button">
            ‹
          </button>
          <div className="flex min-h-0 items-center justify-center p-4">
            {loading ? <p className="text-sm text-white/70">Chargement...</p> : null}
            {!loading && photo ? (
              <div className="relative h-full w-full">
                <Image
                  alt={photo.description || photo.filename}
                  className="object-contain"
                  fill
                  sizes="100vw"
                  src={getPhotoContentUrl(photo.id)}
                  unoptimized
                />
              </div>
            ) : null}
            {!loading && !photo ? <p className="text-sm text-white/70">Photo indisponible.</p> : null}
          </div>
          <button className="hidden text-4xl transition hover:bg-white/10 lg:block" onClick={onNext} type="button">
            ›
          </button>
        </div>
        {photo ? (
          <div className="border-t border-white/10 px-4 py-3 text-sm text-white/80">
            <p className="font-semibold text-white">{photo.description || photo.filename}</p>
            <p className="mt-1">
              {formatAuthor(photo)} · {formatDateTime(photo.timestampLocal)} · GPS {formatGps(photo)}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DeletePhotoModal({
  open,
  reason,
  pending,
  setReason,
  onClose,
  onConfirm,
}: Readonly<{
  open: boolean;
  reason: string;
  pending: boolean;
  setReason: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}>) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-lg rounded-3xl border border-white/20 bg-white p-6 shadow-2xl">
        <h2 className="text-xl font-semibold text-slate-950">Supprimer cette photo ?</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Le motif est obligatoire et sera conserve dans le journal de suppression.</p>
        <label className="mt-5 block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Motif</span>
          <textarea
            className="min-h-28 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-red-500 focus:bg-white"
            onChange={(event) => setReason(event.target.value)}
            value={reason}
          />
        </label>
        <div className="mt-6 flex justify-end gap-3">
          <button className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" onClick={onClose} type="button">
            Annuler
          </button>
          <button
            className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending || reason.trim().length === 0}
            onClick={onConfirm}
            type="button"
          >
            {pending ? 'Suppression...' : 'Supprimer'}
          </button>
        </div>
      </div>
    </div>
  );
}

type UploadPayload = {
  file: File;
  siteId: string;
  category: PhotoCategory;
  description: string;
  timestampLocal: string;
  latitude: number | null;
  longitude: number | null;
};

function PhotoCaptureModal({
  sites,
  defaultSiteId,
  pending,
  onSubmit,
  onClose,
}: Readonly<{
  sites: PhotoSiteOption[];
  defaultSiteId?: string;
  pending: boolean;
  onSubmit: (payload: UploadPayload) => void;
  onClose: () => void;
}>) {
  const { pushToast } = useToast();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [siteId, setSiteId] = useState(defaultSiteId ?? '');
  const [category, setCategory] = useState<PhotoCategory>('PROGRESS');
  const [description, setDescription] = useState('');
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setCameraError("La camera n'est pas disponible dans ce navigateur.");
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch {
        setCameraError("Autorisation camera refusee ou camera indisponible.");
      }
    }

    void startCamera();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  async function handleCapture() {
    if (!videoRef.current || !siteId) {
      return;
    }

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const context = canvas.getContext('2d');
    if (!context) {
      setCameraError('Capture impossible.');
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
      setCameraError('Capture impossible.');
      return;
    }

    const timestampLocal = new Date().toISOString();
    const position = await getCurrentPosition();
    const file = new File([blob], `photo-${timestampLocal.replace(/[:.]/g, '-')}.jpg`, { type: 'image/jpeg' });
    onSubmit({
      file,
      siteId,
      category,
      description,
      timestampLocal,
      latitude: position?.coords.latitude ?? null,
      longitude: position?.coords.longitude ?? null,
    });
  }

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-950/70 p-4">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-white/20 bg-white p-6 shadow-2xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-slate-950">Ajouter une photo</h2>
            <p className="mt-2 text-sm text-slate-500">Capture navigateur, horodatage automatique et GPS si disponible.</p>
          </div>
          <button className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" onClick={onClose} type="button">
            Fermer
          </button>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_0.8fr]">
          <div className="overflow-hidden rounded-3xl bg-slate-950">
            {cameraError ? (
              <div className="flex aspect-video items-center justify-center p-6 text-center text-sm text-white/80">{cameraError}</div>
            ) : (
              <video ref={videoRef} autoPlay className="aspect-video w-full object-cover" muted playsInline />
            )}
          </div>
          <div className="space-y-4">
            <Field label="Chantier">
              <select
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                disabled={sites.length <= 1}
                onChange={(event) => setSiteId(event.target.value)}
                value={siteId}
              >
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Categorie">
              <select
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => setCategory(event.target.value as PhotoCategory)}
                value={category}
              >
                {Object.values(PhotoCategory).map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Description">
              <textarea
                className="min-h-28 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => setDescription(event.target.value)}
                value={description}
              />
            </Field>
            <button
              className="w-full rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={pending || !siteId || Boolean(cameraError)}
              onClick={() => {
                void handleCapture().catch((error) => {
                  pushToast({
                    type: 'error',
                    title: 'Capture impossible',
                    message: error instanceof Error ? error.message : 'La capture a echoue.',
                  });
                });
              }}
              type="button"
            >
              {pending ? 'Envoi...' : 'Capturer et envoyer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function PaginationBar({
  page,
  totalPages,
  totalItems,
  onPrevious,
  onNext,
}: Readonly<{
  page: number;
  totalPages: number;
  totalItems: number;
  onPrevious: () => void;
  onNext: () => void;
}>) {
  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
      <p>
        Page {page} / {totalPages} · {totalItems} photo(s)
      </p>
      <div className="flex gap-2">
        <button className="rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" disabled={page <= 1} onClick={onPrevious} type="button">
          Precedent
        </button>
        <button className="rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" disabled={page >= totalPages} onClick={onNext} type="button">
          Suivant
        </button>
      </div>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="h-72 animate-pulse rounded-3xl border border-slate-200 bg-slate-100" />
      ))}
    </div>
  );
}

function getRelativePhotoId(photos: PhotoItem[], current: string | null, delta: number) {
  if (photos.length === 0) {
    return current;
  }

  const currentIndex = photos.findIndex((photo) => photo.id === current);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + delta + photos.length) % photos.length;
  return photos[nextIndex]?.id ?? current;
}

function formatAuthor(photo: PhotoItem) {
  return `${photo.author.firstName} ${photo.author.lastName}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatDateOnly(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(value));
}

function formatGps(photo: PhotoItem) {
  if (photo.latitude === null || photo.longitude === null) {
    return 'n/a';
  }

  return `${photo.latitude.toFixed(5)}, ${photo.longitude.toFixed(5)}`;
}

function buildDownloadFileName(photo: PhotoItem) {
  const timestamp = photo.timestampLocal.replace(/[^0-9]/g, '').slice(0, 14) || 'timestamp';
  return `${photo.siteId}_${timestamp}_${photo.uploadedById}.jpg`;
}

function getPhotoContentUrl(photoId: string) {
  return `/api/photos/${encodeURIComponent(photoId)}/content`;
}

function getCurrentPosition() {
  if (!navigator.geolocation) {
    return Promise.resolve<GeolocationPosition | null>(null);
  }

  return new Promise<GeolocationPosition | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 0,
    });
  });
}

async function safeJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
