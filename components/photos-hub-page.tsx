'use client';

import dynamic from 'next/dynamic';
import { type Role } from '@prisma/client';
import { EmptyState } from '@/components/empty-state';

const PhotoGallery = dynamic(
  () => import('@/components/photo-gallery').then((module) => module.PhotoGallery),
  {
    loading: () => <GallerySkeleton />,
  },
);

type PhotosHubPageProps = Readonly<{
  viewer: {
    id: string;
    role: Role;
  };
}>;

const PHOTO_GALLERY_ROLES: readonly Role[] = [
  'SUPERVISOR',
  'RESOURCE',
  'EXTERNAL_RESOURCE',
  'COORDINATOR',
  'GENERAL_SUPERVISOR',
  'BE_RESOURCE',
  'NEGOTIATION_RESOURCE',
  'DRIVER',
  'BE_MANAGER',
  'NEGOTIATION_MANAGER',
  'FLEET_MANAGER',
  'PROJECT_MANAGER',
  'DIRECTION',
  'ADMIN',
];

export function PhotosHubPage({ viewer }: PhotosHubPageProps) {
  if (!PHOTO_GALLERY_ROLES.includes(viewer.role)) {
    return (
      <EmptyState
        ctaHref="/web/dashboard"
        ctaLabel="Retour au tableau de bord"
        description="Ce role n'a pas acces a la galerie photos web."
        title="Galerie non autorisee"
      />
    );
  }

  return (
    <PhotoGallery
      description="Vue globale des photos accessibles selon votre role. Utilisez les filtres pour affiner ensuite."
      scope={{ type: 'global' }}
      title="Galerie photos"
      viewer={viewer}
    />
  );
}

function GallerySkeleton() {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
      <div className="h-6 w-48 animate-pulse rounded bg-slate-200" />
      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <div className="h-52 animate-pulse rounded-3xl bg-slate-100" />
        <div className="h-52 animate-pulse rounded-3xl bg-slate-100" />
        <div className="h-52 animate-pulse rounded-3xl bg-slate-100" />
      </div>
    </section>
  );
}
