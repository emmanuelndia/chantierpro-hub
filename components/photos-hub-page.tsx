'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { type Role } from '@prisma/client';
import { useQuery } from '@tanstack/react-query';
import { EmptyState } from '@/components/empty-state';
import { authFetch } from '@/lib/auth/client-session';
import type { PaginatedProjectsResponse, TodaySiteItem } from '@/types/projects';

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

const PROJECT_SCOPE_ROLES: readonly Role[] = ['PROJECT_MANAGER', 'DIRECTION', 'ADMIN'];
const SITE_SCOPE_ROLES: readonly Role[] = ['SUPERVISOR', 'COORDINATOR', 'GENERAL_SUPERVISOR'];

export function PhotosHubPage({ viewer }: PhotosHubPageProps) {
  if (PROJECT_SCOPE_ROLES.includes(viewer.role)) {
    return <ProjectPhotosHub viewer={viewer} />;
  }

  if (SITE_SCOPE_ROLES.includes(viewer.role)) {
    return <SitePhotosHub viewer={viewer} />;
  }

  return (
    <EmptyState
      ctaHref="/web/dashboard"
      ctaLabel="Retour au tableau de bord"
      description="Ce role n'a pas acces a la galerie photos web."
      title="Galerie non autorisee"
    />
  );
}

function ProjectPhotosHub({ viewer }: PhotosHubPageProps) {
  const [projectId, setProjectId] = useState('');
  const projectsQuery = useQuery({
    queryKey: ['photos-hub-projects'],
    queryFn: async () => {
      const response = await authFetch('/api/projects?page=1', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Projects request failed with status ${response.status}`);
      }

      return (await response.json()) as PaginatedProjectsResponse;
    },
    staleTime: 300_000,
  });

  const projects = useMemo(() => projectsQuery.data?.items ?? [], [projectsQuery.data?.items]);
  const selectedProject = projects.find((project) => project.id === projectId) ?? projects[0] ?? null;

  useEffect(() => {
    if (!projectId && projects[0]) {
      setProjectId(projects[0].id);
    }
  }, [projectId, projects]);

  if (projectsQuery.isLoading) {
    return <LoadingCard message="Chargement des projets..." />;
  }

  if (projectsQuery.isError) {
    return (
      <EmptyState
        description="La liste des projets n'a pas pu etre chargee."
        title="Galerie indisponible"
      />
    );
  }

  if (!selectedProject) {
    return (
      <EmptyState
        description="Aucun projet accessible ne permet encore d'afficher une galerie."
        title="Aucun projet"
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Projet</span>
          <select
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
            onChange={(event) => setProjectId(event.target.value)}
            value={selectedProject.id}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      <PhotoGallery
        description="Vue consolidee des photos accessibles pour le projet selectionne."
        scope={{
          type: 'project',
          projectId: selectedProject.id,
        }}
        title={`Galerie photos - ${selectedProject.name}`}
        viewer={viewer}
      />
    </div>
  );
}

function SitePhotosHub({ viewer }: PhotosHubPageProps) {
  const [siteId, setSiteId] = useState('');
  const sitesQuery = useQuery({
    queryKey: ['photos-hub-today-sites'],
    queryFn: async () => {
      const response = await authFetch('/api/users/me/sites/today', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Today sites request failed with status ${response.status}`);
      }

      return ((await response.json()) as { items: TodaySiteItem[] }).items;
    },
    staleTime: 300_000,
  });

  const sites = useMemo(() => sitesQuery.data ?? [], [sitesQuery.data]);
  const selectedSite = useMemo(
    () => sites.find((site) => site.id === siteId) ?? sites[0] ?? null,
    [siteId, sites],
  );

  useEffect(() => {
    if (!siteId && sites[0]) {
      setSiteId(sites[0].id);
    }
  }, [siteId, sites]);

  if (sitesQuery.isLoading) {
    return <LoadingCard message="Chargement des chantiers..." />;
  }

  if (sitesQuery.isError) {
    return (
      <EmptyState
        description="Les chantiers accessibles n'ont pas pu etre charges."
        title="Galerie indisponible"
      />
    );
  }

  if (!selectedSite) {
    return (
      <EmptyState
        description="Aucun chantier accessible aujourd'hui pour afficher ou ajouter des photos."
        title="Aucun chantier"
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
        <label className="block space-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Chantier</span>
          <select
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
            onChange={(event) => setSiteId(event.target.value)}
            value={selectedSite.id}
          >
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      <PhotoGallery
        description="Photos du chantier selectionne, avec visibilite appliquee selon votre role."
        scope={{
          type: 'site',
          siteId: selectedSite.id,
          siteName: selectedSite.name,
        }}
        title={`Galerie photos - ${selectedSite.name}`}
        viewer={viewer}
      />
    </div>
  );
}

function LoadingCard({ message }: Readonly<{ message: string }>) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
      {message}
    </div>
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
