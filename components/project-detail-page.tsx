'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectStatus, Role, SiteGeofenceType, SiteStatus, SiteType } from '@prisma/client';
import { Badge } from '@/components/badge';
import { ConfirmModal } from '@/components/confirm-modal';
import { DocumentAttachmentsPanel } from '@/components/document-attachments-panel';
import { EmptyState } from '@/components/empty-state';
import { PhotoGallery } from '@/components/photo-gallery';
import { SiteLocationPicker } from '@/components/site-location-picker';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import type {
  ProjectDetail,
  ProjectFormOptionsResponse,
  ProjectPresenceSummary,
  ProjectSiteItem,
  ProjectTeamSummaryResponse,
  SiteGeofencePolygon,
  SiteImportCommitResponse,
  SiteImportPreviewResponse,
  SiteImportPreviewRow,
} from '@/types/projects';

type ProjectDetailPageProps = Readonly<{
  projectId: string;
  viewer: {
    id: string;
    role: Role;
  };
}>;

type NegotiationScopeItem = {
  id: string;
  name: string;
  city: string;
  commune: string | null;
  plaque: string | null;
  cluster: string | null;
  contactInfo: string | null;
  latitude: number | null;
  longitude: number | null;
  negotiationStatus: string | null;
  remark: string | null;
};

type NegotiationScopesResponse = {
  buildings: NegotiationScopeItem[];
};

type NegotiationZoneItem = {
  id: string;
  projectId: string;
  name: string;
  city: string | null;
  region: string | null;
  scopeCount: number;
};

type NegotiationZonesResponse = {
  zones: NegotiationZoneItem[];
};

type SiteFormValues = {
  projectId: string;
  name: string;
  address: string;
  siteType: SiteType;
  requiresClockIn: boolean;
  latitude: string;
  longitude: string;
  radiusKm: number;
  geofenceType: SiteGeofenceType;
  geofencePolygon: SiteGeofencePolygon | null;
  description: string;
  status: SiteStatus;
  area: string;
  startDate: string;
  endDate: string;
  siteManagerId: string;
};

type SiteMutationBody = Partial<{
  projectId: string;
  name: string;
  address: string;
  siteType: SiteType;
  requiresClockIn: boolean;
  latitude: number;
  longitude: number;
  radiusKm: number;
  geofenceType: SiteGeofenceType;
  geofencePolygon: SiteGeofencePolygon | null;
  description: string;
  status: SiteStatus;
  area: number;
  startDate: string;
  endDate: string | null;
  siteManagerId: string;
}>;

const SITE_WRITE_ROLES: readonly Role[] = [
  'PROJECT_MANAGER',
  'BE_MANAGER',
  'NEGOTIATION_MANAGER',
  'FLEET_MANAGER',
  'DIRECTION',
  'ADMIN',
];

const PROJECT_DOCUMENT_ROLES: readonly Role[] = ['PROJECT_MANAGER', 'DIRECTION', 'ADMIN'];
const INTERVENTION_ZONE_RADIUS_KM = 10;

export function ProjectDetailPage({ projectId, viewer }: ProjectDetailPageProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<'sites' | 'team' | 'presences' | 'photos' | 'documents'>('sites');
  const [siteDrawerOpen, setSiteDrawerOpen] = useState(false);
  const [siteImportOpen, setSiteImportOpen] = useState(false);
  const [scopeDrawerOpen, setScopeDrawerOpen] = useState(false);
  const [scopeImportOpen, setScopeImportOpen] = useState(false);
  const [zoneDrawerOpen, setZoneDrawerOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<ProjectSiteItem | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [selectedSiteIdsToComplete, setSelectedSiteIdsToComplete] = useState<string[]>([]);

  const projectQuery = useQuery({
    queryKey: ['project-detail', projectId],
    queryFn: async () => {
      const response = await authFetch(`/api/projects/${projectId}`);
      if (!response.ok) {
        throw new Error(`Project detail request failed with status ${response.status}`);
      }
      return ((await response.json()) as { project: ProjectDetail }).project;
    },
  });

  const formOptionsQuery = useQuery({
    queryKey: ['project-form-options'],
    queryFn: async () => {
      const response = await authFetch('/api/projects/form-options');
      if (!response.ok) {
        throw new Error(`Project form options request failed with status ${response.status}`);
      }
      return (await response.json()) as ProjectFormOptionsResponse;
    },
  });

  const teamQuery = useQuery({
    queryKey: ['project-team-summary', projectId],
    queryFn: async () => {
      const response = await authFetch(`/api/projects/${projectId}/team`);
      if (!response.ok) {
        throw new Error(`Project team request failed with status ${response.status}`);
      }
      return (await response.json()) as ProjectTeamSummaryResponse;
    },
  });

  const presencesQuery = useQuery({
    queryKey: ['project-presences-summary', projectId],
    queryFn: async () => {
      const response = await authFetch(`/api/projects/${projectId}/presences`);
      if (!response.ok) {
        throw new Error(`Project presences request failed with status ${response.status}`);
      }
      return (await response.json()) as ProjectPresenceSummary;
    },
  });

  const isNegotiationProjectMode = viewer.role === 'NEGOTIATION_MANAGER';
  const scopesQuery = useQuery({
    queryKey: ['negotiation-project-scopes', projectId],
    queryFn: async () => {
      const response = await authFetch(`/api/negotiation/buildings?projectId=${encodeURIComponent(projectId)}`);
      if (!response.ok) {
        throw new Error('Scopes indisponibles.');
      }
      return (await response.json()) as NegotiationScopesResponse;
    },
    enabled: isNegotiationProjectMode,
  });

  const zonesQuery = useQuery({
    queryKey: ['negotiation-project-zones', projectId],
    queryFn: async () => {
      const response = await authFetch(`/api/negotiation/zones?projectId=${encodeURIComponent(projectId)}`);
      if (!response.ok) {
        throw new Error('Zones indisponibles.');
      }
      return (await response.json()) as NegotiationZonesResponse;
    },
    enabled: isNegotiationProjectMode,
  });

  const saveSiteMutation = useMutation({
    mutationFn: async (values: SiteFormValues) => {
      const body = editingSite
        ? buildPartialSiteMutationBody(values, editingSite, canManageRadius)
        : buildCreateSiteMutationBody(values, canManageRadius);
      const targetProjectId = values.projectId || projectId;

      const response = await authFetch(editingSite ? `/api/sites/${editingSite.id}` : `/api/projects/${targetProjectId}/sites`, {
        method: editingSite ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Impossible de sauvegarder le chantier.');
      }

      return ((await response.json()) as { site?: ProjectSiteItem }).site ?? null;
    },
    onSuccess: (savedSite) => {
      void queryClient.invalidateQueries({ queryKey: ['project-detail', projectId] });
      if (editingSite?.projectId && editingSite.projectId !== projectId) {
        void queryClient.invalidateQueries({ queryKey: ['project-detail', editingSite.projectId] });
      }
      if (savedSite?.projectId && savedSite.projectId !== projectId) {
        void queryClient.invalidateQueries({ queryKey: ['project-detail', savedSite.projectId] });
      }
      void queryClient.invalidateQueries({ queryKey: ['projects-list'] });
      setSiteDrawerOpen(false);
      setEditingSite(null);
      pushToast({
        type: 'success',
        title: editingSite ? 'Chantier mis a jour' : 'Chantier cree',
      });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Sauvegarde impossible',
        message: error instanceof Error ? error.message : 'Le chantier n a pas pu etre enregistre.',
      });
    },
  });

  const archiveProjectMutation = useMutation({
    mutationFn: async () => {
      const response = await authFetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? "Impossible d'archiver ce projet.");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-detail', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['projects-list'] });
      setArchiveOpen(false);
      pushToast({
        type: 'success',
        title: 'Projet archive',
      });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Archivage impossible',
        message: error instanceof Error ? error.message : "Le projet n'a pas pu etre archive.",
      });
    },
  });

  const completeSitesMutation = useMutation({
    mutationFn: async (siteIds: string[]) => {
      const response = await authFetch(`/api/projects/${projectId}/sites/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteIds }),
      });

      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Impossible de terminer les sites selectionnes.');
      }

      return (await response.json()) as { updatedCount: number };
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['project-detail', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['projects-list'] });
      setSelectedSiteIdsToComplete([]);
      pushToast({
        type: 'success',
        title: `${result.updatedCount} site(s) termine(s)`,
      });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Cloture impossible',
        message: error instanceof Error ? error.message : 'Les sites selectionnes n ont pas pu etre termines.',
      });
    },
  });

  const project = projectQuery.data;
  const canManageRadius = viewer.role === 'DIRECTION' || viewer.role === 'ADMIN';
  const canManageProject = viewer.role === 'PROJECT_MANAGER' || viewer.role === 'DIRECTION' || viewer.role === 'ADMIN';
  const canManageSites = SITE_WRITE_ROLES.includes(viewer.role);
  const canManageProjectDocuments = PROJECT_DOCUMENT_ROLES.includes(viewer.role);
  const completableSites = project?.sites.filter((site) => site.status !== 'COMPLETED') ?? [];
  const allCompletableSitesSelected =
    completableSites.length > 0 && completableSites.every((site) => selectedSiteIdsToComplete.includes(site.id));

  useEffect(() => {
    if (!project) return;
    const completableSiteIds = new Set(project.sites.filter((site) => site.status !== 'COMPLETED').map((site) => site.id));
    setSelectedSiteIdsToComplete((current) => current.filter((siteId) => completableSiteIds.has(siteId)));
  }, [project]);

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    if (
      requestedTab === 'sites' ||
      requestedTab === 'team' ||
      requestedTab === 'presences' ||
      requestedTab === 'photos' ||
      (requestedTab === 'documents' && canManageProjectDocuments)
    ) {
      setActiveTab(requestedTab);
    }
  }, [canManageProjectDocuments, searchParams]);

  const tabs = useMemo(
    () => [
      { id: 'sites', label: isNegotiationProjectMode ? 'Scopes' : 'Sites' },
      { id: 'team', label: 'Equipe' },
      { id: 'presences', label: 'Presences' },
      { id: 'photos', label: 'Photos' },
      ...(canManageProjectDocuments ? [{ id: 'documents' as const, label: 'Documents' }] : []),
    ] as const,
    [canManageProjectDocuments, isNegotiationProjectMode],
  );

  if (projectQuery.isLoading) {
    return <LoadingCard message="Chargement du projet..." />;
  }

  if (projectQuery.isError || !project) {
    return (
      <EmptyState
        ctaHref={viewer.role === 'PROJECT_MANAGER' ? '/web/my-projects' : '/web/projects'}
        ctaLabel="Retour aux projets"
        description="Le detail du projet n'a pas pu etre charge ou n'est plus accessible avec ce role."
        title="Projet indisponible"
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={projectStatusTone(project.status)}>{humanizeProjectStatus(project.status)}</Badge>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {isNegotiationProjectMode
                  ? `${scopesQuery.data?.buildings.length ?? 0} scope(s)`
                  : `${project.sitesCount} site(s) - ${project.resourcesCount} ressource(s)`}
              </p>
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{project.name}</h1>
            {project.description ? (
              <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-600">{project.description}</p>
            ) : null}
            <p className="mt-4 text-sm text-slate-500">
              {project.city} - {project.address} - {formatDate(project.startDate)} â†’ {project.endDate ? formatDate(project.endDate) : 'Ouvert'}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {isNegotiationProjectMode ? (
              <button
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                hidden={!canManageSites}
                onClick={() => setZoneDrawerOpen(true)}
                type="button"
              >
                Créer zone
              </button>
            ) : null}
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              onClick={() => {
                if (isNegotiationProjectMode) {
                  setScopeDrawerOpen(true);
                  return;
                }
                setEditingSite(null);
                setSiteDrawerOpen(true);
              }}
              type="button"
            >
              {isNegotiationProjectMode ? 'Créer scope' : 'Créer chantier'}
            </button>
            <button
              className="rounded-full border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-semibold text-orange-700 transition hover:bg-orange-100"
              hidden={!canManageSites}
              onClick={() => (isNegotiationProjectMode ? setScopeImportOpen(true) : setSiteImportOpen(true))}
              type="button"
            >
              {isNegotiationProjectMode ? 'Importer scopes' : 'Importer des chantiers'}
            </button>
            <Link
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              href={`/web/teams/new?projectId=${encodeURIComponent(projectId)}`}
              hidden={!canManageProject}
            >
              Créer équipe
            </Link>
            <button
              className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
              hidden={!canManageProject}
              onClick={() => setArchiveOpen(true)}
              type="button"
            >
              Archiver le projet
            </button>
          </div>
        </div>
      </section>

      <section className="flex flex-wrap gap-2 rounded-[2rem] border border-slate-200 bg-white p-3 shadow-panel">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              activeTab === tab.id ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </section>

      {activeTab === 'sites' && isNegotiationProjectMode ? (
        <section className="space-y-4">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Zones du projet</p>
                <h2 className="mt-1 text-xl font-semibold text-slate-950">Regroupements pour le planning négo</h2>
              </div>
              <Badge tone="info">{zonesQuery.data?.zones.length ?? 0} zone(s)</Badge>
            </div>
            {zonesQuery.isLoading ? <LoadingCard message="Chargement des zones..." /> : null}
            {!zonesQuery.isLoading && (zonesQuery.data?.zones.length ?? 0) === 0 ? (
              <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-semibold text-slate-500">
                Aucune zone créée. Tu peux créer une zone manuellement ou importer les scopes, l&apos;import créera aussi les zones détectées.
              </p>
            ) : null}
            {zonesQuery.data?.zones.length ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {zonesQuery.data.zones.map((zone) => (
                  <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4" key={zone.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-semibold text-slate-950">{zone.name}</h3>
                        <p className="mt-1 truncate text-sm text-slate-500">{[zone.city, zone.region].filter(Boolean).join(' - ') || 'Localisation non renseignée'}</p>
                      </div>
                      <Badge tone="neutral">{zone.scopeCount} scope(s)</Badge>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
          {scopesQuery.isLoading ? (
            <div className="xl:col-span-2">
              <LoadingCard message="Chargement des scopes..." />
            </div>
          ) : (scopesQuery.data?.buildings.length ?? 0) === 0 ? (
            <div className="xl:col-span-2">
              <EmptyState
                description="Ce projet n'a pas encore de scope de negociation. Cree un scope ou importe la base a traiter."
                title="Aucun scope"
              />
            </div>
          ) : (
            scopesQuery.data?.buildings.map((scope) => (
              <article key={scope.id} className="space-y-4 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-xl font-semibold text-slate-950">{scope.name}</h2>
                      {scope.negotiationStatus ? <Badge tone="info">{scope.negotiationStatus}</Badge> : <Badge tone="neutral">Non traite</Badge>}
                    </div>
                    <p className="mt-3 text-sm text-slate-500">
                      {[scope.city, scope.commune].filter(Boolean).join(' - ') || 'Zone non renseignee'}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {scope.cluster ? <Badge tone="info">{scope.cluster}</Badge> : null}
                      {scope.plaque ? <Badge tone="neutral">{scope.plaque}</Badge> : null}
                    </div>
                    {scope.contactInfo ? <p className="mt-3 text-sm font-semibold text-slate-600">Contact : {scope.contactInfo}</p> : null}
                    {scope.remark ? <p className="mt-2 text-sm text-slate-500">{scope.remark}</p> : null}
                  </div>
                  {scope.latitude && scope.longitude ? (
                    <a
                      className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                      href={`https://www.google.com/maps?q=${scope.latitude},${scope.longitude}`}
                      target="_blank"
                    >
                      Voir GPS
                    </a>
                  ) : null}
                </div>
              </article>
            ))
          )}
          </div>
        </section>
      ) : null}

      {activeTab === 'sites' && !isNegotiationProjectMode ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {canManageSites && completableSites.length > 0 ? (
            <div className="xl:col-span-2 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Cloture des sites</p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-950">Terminer une selection de sites</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Termine uniquement les sites cochés. Quand il ne reste plus de site actif, tu peux archiver le projet.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    onClick={() =>
                      setSelectedSiteIdsToComplete(
                        allCompletableSitesSelected ? [] : completableSites.map((site) => site.id),
                      )
                    }
                    type="button"
                  >
                    {allCompletableSitesSelected ? 'Tout décocher' : 'Tout sélectionner'}
                  </button>
                  <button
                    className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={selectedSiteIdsToComplete.length === 0 || completeSitesMutation.isPending}
                    onClick={() => completeSitesMutation.mutate(selectedSiteIdsToComplete)}
                    type="button"
                  >
                    {completeSitesMutation.isPending
                      ? 'Cloture...'
                      : `Terminer ${selectedSiteIdsToComplete.length} site(s)`}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {project.sites.length === 0 ? (
            <div className="xl:col-span-2">
              <EmptyState
                description="Ce projet n'a pas encore de chantier rattache. Cree le premier site pour commencer."
                title="Aucun chantier"
              />
            </div>
          ) : (
            project.sites.map((site) => (
              <article key={site.id} className="space-y-4 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      {canManageSites && site.status !== 'COMPLETED' ? (
                        <label className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50">
                          <input
                            checked={selectedSiteIdsToComplete.includes(site.id)}
                            className="h-4 w-4 accent-orange-600"
                            onChange={(event) =>
                              setSelectedSiteIdsToComplete((current) =>
                                event.target.checked
                                  ? [...new Set([...current, site.id])]
                                  : current.filter((siteId) => siteId !== site.id),
                              )
                            }
                            title={`Selectionner ${site.name}`}
                            type="checkbox"
                          />
                        </label>
                      ) : null}
                      <h2 className="text-xl font-semibold text-slate-950">{site.name}</h2>
                      <Badge tone={site.status === 'ACTIVE' ? 'success' : site.status === 'ON_HOLD' ? 'warning' : 'neutral'}>
                        {site.status}
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm text-slate-500">{site.address}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge tone="info">{siteTypeLabel(site.siteType)}</Badge>
                      <Badge tone={site.requiresClockIn ? 'success' : 'neutral'}>
                        {site.requiresClockIn ? 'Pointage requis' : 'Pointage non requis'}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-400">
                      {site.requiresClockIn
                        ? site.geofenceType === 'POLYGON'
                          ? 'Limite précise'
                          : `Pointage par rayon ${site.radiusKm.toFixed(1)} km`
                        : 'Lieu planifiable sans flux terrain'} - Surface estimee {formatEstimatedArea(site.area)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50" href={`/web/projects/${projectId}?tab=photos&siteId=${encodeURIComponent(site.id)}`}>
                      Photos
                    </Link>
                    <Link className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50" href={`/web/sites/${site.id}/presences`}>
                      Présences
                    </Link>
                    <Link className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50" href={`/web/teams?projectId=${encodeURIComponent(projectId)}&siteId=${encodeURIComponent(site.id)}`} hidden={!canManageProject}>
                      Equipes
                    </Link>
                    <Link className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50" href={`/web/teams/new?projectId=${encodeURIComponent(projectId)}&siteId=${encodeURIComponent(site.id)}`} hidden={!canManageProject}>
                      Créer équipe
                    </Link>
                    <button
                      className="rounded-full border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-700 transition hover:bg-orange-100"
                      onClick={() => {
                        setEditingSite(site);
                        setSiteDrawerOpen(true);
                      }}
                      type="button"
                    >
                      Editer
                    </button>
                  </div>
                </div>
                {canManageProjectDocuments ? (
                  <DocumentAttachmentsPanel
                    canUpload={canManageProjectDocuments}
                    compact
                    context={{ siteId: site.id }}
                    description="Documents rattachés à ce chantier."
                    title="Documents chantier"
                  />
                ) : null}
              </article>
            ))
          )}
        </section>
      ) : null}

      {activeTab === 'team' ? (
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
          {teamQuery.isLoading ? <LoadingCard message="Chargement de l'equipe..." /> : null}
          {teamQuery.data ? (
            <div className="space-y-5">
              <div className="grid gap-4 md:grid-cols-3">
                <MetricCard label="Equipes actives" value={teamQuery.data.teamsCount} />
                <MetricCard label="Ressources" value={teamQuery.data.resourcesCount} />
                <MetricCard label="Periode" value={`${teamQuery.data.month}/${teamQuery.data.year}`} />
              </div>
              <div className="space-y-3">
                {teamQuery.data.items.map((item) => (
                  <article key={item.userId} className="rounded-3xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <Link
                          className="font-semibold text-slate-950 underline-offset-4 hover:text-orange-700 hover:underline"
                          href={`/web/users/${encodeURIComponent(item.userId)}/assignments-history`}
                        >
                          {item.firstName} {item.lastName}
                        </Link>
                        <p className="text-sm text-slate-500">
                          {item.role} - {item.email}
                        </p>
                      </div>
                      <Badge tone="info">{item.hoursThisMonth.toFixed(2)} h ce mois</Badge>
                    </div>
                    <p className="mt-3 text-sm text-slate-600">
                      Equipes : {item.teamNames.join(', ') || 'Aucune'}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Sites : {item.siteNames.join(', ') || 'Aucun'}
                    </p>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === 'presences' ? (
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
          {presencesQuery.isLoading ? <LoadingCard message="Chargement des presences..." /> : null}
          {presencesQuery.data ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <MetricCard label="Sites actifs" value={presencesQuery.data.totals.activeSites} />
                <MetricCard label="Ressources presentes" value={presencesQuery.data.totals.presentWorkers} />
                <MetricCard label="Date" value={presencesQuery.data.date} />
              </div>
              {presencesQuery.data.sites.map((site) => (
                <article key={site.id} className="rounded-3xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">{site.name}</p>
                      <p className="text-sm text-slate-500">
                        {site.presentCount} ressource(s) {site.contextType === 'FREE_MISSION' ? 'en mission libre' : 'sur site'} - {site.contextLabel}
                      </p>
                    </div>
                    {site.contextType === 'SITE' ? (
                      <Link
                        className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        href={`/web/sites/${site.id}/presences`}
                      >
                        Ouvrir le detail
                      </Link>
                    ) : (
                      <span className="rounded-full bg-orange-50 px-3 py-2 text-xs font-bold text-orange-700">
                        Pointage GPS mission
                      </span>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {site.workers.map((worker) => (
                      <div className="flex flex-wrap items-center gap-2" key={worker.userId}>
                        <Badge tone="success">
                          {worker.firstName} {worker.lastName}
                        </Badge>
                        {worker.gpsPointage.arrivalLatitude !== null && worker.gpsPointage.arrivalLongitude !== null ? (
                          <a
                            className="rounded-full bg-slate-950 px-3 py-1 text-xs font-bold text-white transition hover:bg-slate-800"
                            href={buildGpsMapUrl(worker.gpsPointage.arrivalLatitude, worker.gpsPointage.arrivalLongitude)}
                            rel="noreferrer"
                            target="_blank"
                          >
                            Voir position GPS
                          </a>
                        ) : null}
                      </div>
                    ))}
                    {site.workers.length === 0 ? <Badge tone="warning">Aucune presence</Badge> : null}
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === 'photos' ? (
        <PhotoGallery
          description="Photos rattachees aux chantiers de ce projet, filtrees par periode et auteur."
          scope={{
            type: 'project',
            projectId,
            sites: project.sites.map((site) => ({ id: site.id, name: site.name })),
          }}
          title={`Galerie photo - ${project.name}`}
          viewer={viewer}
        />
      ) : null}

      {activeTab === 'documents' ? (
        <DocumentAttachmentsPanel
          canUpload={canManageProjectDocuments}
          context={{ projectId }}
          description="Documents, PV, Excel et livrables rattachés au projet."
          title={`Documents - ${project.name}`}
        />
      ) : null}

      <ScopeFormDrawer
        onClose={() => setScopeDrawerOpen(false)}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: ['negotiation-project-scopes', projectId] });
          void queryClient.invalidateQueries({ queryKey: ['negotiation-project-zones', projectId] });
          void queryClient.invalidateQueries({ queryKey: ['negotiation-overview'] });
        }}
        open={scopeDrawerOpen}
        projectId={projectId}
      />

      <ZoneFormDrawer
        onClose={() => setZoneDrawerOpen(false)}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: ['negotiation-project-zones', projectId] });
          void queryClient.invalidateQueries({ queryKey: ['negotiation-overview'] });
          void queryClient.invalidateQueries({ queryKey: ['web-planning'] });
        }}
        open={zoneDrawerOpen}
        projectId={projectId}
      />

      <ScopeImportModal
        onClose={() => setScopeImportOpen(false)}
        onImported={() => {
          void queryClient.invalidateQueries({ queryKey: ['negotiation-project-scopes', projectId] });
          void queryClient.invalidateQueries({ queryKey: ['negotiation-project-zones', projectId] });
          void queryClient.invalidateQueries({ queryKey: ['negotiation-overview'] });
        }}
        open={scopeImportOpen}
        projectId={projectId}
      />

      <SiteFormDrawer
        canManageRadius={canManageRadius}
        currentProjectId={projectId}
        initialSite={editingSite}
        onClose={() => {
          setSiteDrawerOpen(false);
          setEditingSite(null);
        }}
        onSubmit={(values) => saveSiteMutation.mutate(values)}
        open={siteDrawerOpen}
        options={formOptionsQuery.data ?? null}
        pending={saveSiteMutation.isPending}
      />

      <SiteImportModal
        onClose={() => setSiteImportOpen(false)}
        onImported={() => {
          void queryClient.invalidateQueries({ queryKey: ['project-detail', projectId] });
        }}
        open={siteImportOpen}
        projectId={projectId}
      />

      <ConfirmModal
        cancelLabel="Annuler"
        confirmLabel="Archiver le projet"
        description="Le projet sera archive seulement s'il ne contient plus de chantier actif."
        destructive
        onClose={() => setArchiveOpen(false)}
        onConfirm={() => archiveProjectMutation.mutate()}
        open={archiveOpen}
        title="Archiver ce projet ?"
      />
    </div>
  );
}

function SiteImportModal({
  open,
  projectId,
  onImported,
  onClose,
}: Readonly<{
  open: boolean;
  projectId: string;
  onImported: () => void;
  onClose: () => void;
}>) {
  const { pushToast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SiteImportPreviewResponse | null>(null);
  const [commitResult, setCommitResult] = useState<SiteImportCommitResponse | null>(null);

  const previewMutation = useMutation({
    mutationFn: async (selectedFile: File) => {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await authFetch(`/api/projects/${projectId}/sites/import/preview`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? "Impossible d'analyser ce fichier.");
      }

      return (await response.json()) as SiteImportPreviewResponse;
    },
    onSuccess: (data) => {
      setPreview(data);
      setCommitResult(null);
      pushToast({
        type: data.errorRows > 0 ? 'warning' : 'success',
        title: 'Prévisualisation prête',
        message: `${data.validRows} ligne(s) valide(s), ${data.errorRows} ligne(s) en erreur.`,
      });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Analyse impossible',
        message: error instanceof Error ? error.message : "Le fichier n'a pas pu etre analyse.",
      });
    },
  });

  const commitMutation = useMutation({
    mutationFn: async (rows: SiteImportPreviewRow[]) => {
      const response = await authFetch(`/api/projects/${projectId}/sites/import/commit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rows: rows.map((row) => row.normalized) }),
      });

      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? "Impossible d'importer les chantiers.");
      }

      return (await response.json()) as SiteImportCommitResponse;
    },
    onSuccess: (data) => {
      setCommitResult(data);
      setPreview({
        projectId: data.projectId ?? projectId,
        totalRows: data.rows.length,
        validRows: data.rows.filter((row) => row.valid).length,
        errorRows: data.rows.filter((row) => row.errors.length > 0).length,
        warningRows: data.rows.filter((row) => row.warnings.length > 0).length,
        rows: data.rows,
      });
      onImported();
      pushToast({
        type: 'success',
        title: 'Import terminé',
        message: `${data.createdCount} chantier(s) créé(s), ${data.skippedCount} ligne(s) ignorée(s).`,
      });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Import impossible',
        message: error instanceof Error ? error.message : "Les chantiers n'ont pas pu etre importes.",
      });
    },
  });

  if (!open) {
    return null;
  }

  const validRows = preview?.rows.filter((row) => row.valid) ?? [];

  return (
    <div className="fixed inset-0 z-[78] flex items-center justify-center bg-slate-950/55 p-4">
      <div className="custom-scrollbar max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
              Import chantiers
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950">Importer des chantiers en masse</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Téléchargez le modèle, remplissez les lignes puis importez le fichier. Les lignes en erreur restent ignorées.
            </p>
          </div>
          <button
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            Fermer
          </button>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <article className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">1. Modèle</p>
            <p className="mt-2 text-sm text-slate-600">
              Le modèle contient toutes les colonnes attendues pour créer les chantiers.
            </p>
            <a
              className="mt-4 inline-flex rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              href={`/api/projects/${projectId}/sites/import/template`}
            >
              Télécharger le modèle
            </a>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">2. Fichier</p>
            <input
              accept=".xlsx,.csv"
              className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
                setCommitResult(null);
              }}
              type="file"
            />
            <button
              className="mt-4 rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!file || previewMutation.isPending}
              onClick={() => file && previewMutation.mutate(file)}
              type="button"
            >
              {previewMutation.isPending ? 'Analyse...' : 'Prévisualiser'}
            </button>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">3. Import</p>
            <p className="mt-2 text-sm text-slate-600">
              Importez uniquement les lignes valides après vérification.
            </p>
            <button
              className="mt-4 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={validRows.length === 0 || commitMutation.isPending}
              onClick={() => commitMutation.mutate(validRows)}
              type="button"
            >
              {commitMutation.isPending ? 'Import...' : 'Importer les lignes valides'}
            </button>
          </article>
        </div>

        {preview ? (
          <div className="mt-6 space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <MetricCard label="Total lignes" value={preview.totalRows} />
              <MetricCard label="Valides" value={preview.validRows} />
              <MetricCard label="Erreurs" value={preview.errorRows} />
              <MetricCard label="Warnings" value={preview.warningRows} />
            </div>

            {commitResult ? (
              <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                {commitResult.createdCount} chantier(s) créé(s). {commitResult.skippedCount} ligne(s) ignorée(s).
              </div>
            ) : null}

            <div className="overflow-hidden rounded-3xl border border-slate-200">
              <div className="custom-scrollbar max-h-[48vh] overflow-auto">
                <table className="min-w-[980px] divide-y divide-slate-200 text-left text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Ligne</th>
                      <th className="px-4 py-3">Statut</th>
                      <th className="px-4 py-3">Chantier</th>
                      <th className="px-4 py-3">Responsable GS</th>
                      <th className="px-4 py-3">GPS</th>
                      <th className="px-4 py-3">Messages</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {preview.rows.map((row) => (
                      <tr key={row.rowNumber}>
                        <td className="px-4 py-3 font-semibold text-slate-900">{row.rowNumber}</td>
                        <td className="px-4 py-3">
                          <Badge tone={row.valid ? (row.warnings.length > 0 ? 'warning' : 'success') : 'error'}>
                            {row.valid ? 'Valide' : 'Erreur'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-semibold text-slate-950">{row.normalized.nom || '-'}</p>
                          <p className="text-xs text-slate-500">{row.normalized.adresse_ou_repere || 'Adresse non renseignée'}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{row.normalized.responsable_gs_email || '-'}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {row.normalized.latitude || '-'}, {row.normalized.longitude || '-'}
                        </td>
                        <td className="px-4 py-3">
                          <ImportMessages row={row} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ScopeFormDrawer({
  open,
  projectId,
  onCreated,
  onClose,
}: Readonly<{
  open: boolean;
  projectId: string;
  onCreated: () => void;
  onClose: () => void;
}>) {
  const { pushToast } = useToast();
  const [form, setForm] = useState({
    name: '',
    city: '',
    commune: '',
    plaque: '',
    cluster: '',
    contactInfo: '',
    latitude: '',
    longitude: '',
    remark: '',
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await authFetch('/api/negotiation/buildings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          ...form,
        }),
      });
      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Impossible de creer le scope.');
      }
      return response.json() as Promise<unknown>;
    },
    onSuccess: () => {
      pushToast({ type: 'success', title: 'Scope cree' });
      setForm({ name: '', city: '', commune: '', plaque: '', cluster: '', contactInfo: '', latitude: '', longitude: '', remark: '' });
      onCreated();
      onClose();
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Creation impossible',
        message: error instanceof Error ? error.message : 'Le scope n a pas pu etre cree.',
      });
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/45">
      <aside className="custom-scrollbar h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Nouveau scope</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">Créer un scope</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Un scope peut être un immeuble, un client, un point bloquant ou tout élément à négocier.
            </p>
          </div>
          <button className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700" onClick={onClose} type="button">
            Fermer
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <ScopeInput label="Nom du scope" required value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
          <div className="grid gap-3 sm:grid-cols-2">
            <ScopeInput label="Ville" value={form.city} onChange={(value) => setForm((current) => ({ ...current, city: value }))} />
            <ScopeInput label="Commune / zone" value={form.commune} onChange={(value) => setForm((current) => ({ ...current, commune: value }))} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ScopeInput label="Cluster" value={form.cluster} onChange={(value) => setForm((current) => ({ ...current, cluster: value }))} />
            <ScopeInput label="Plaque" value={form.plaque} onChange={(value) => setForm((current) => ({ ...current, plaque: value }))} />
          </div>
          <ScopeInput label="Contact / interlocuteur" value={form.contactInfo} onChange={(value) => setForm((current) => ({ ...current, contactInfo: value }))} />
          <div className="grid gap-3 sm:grid-cols-2">
            <ScopeInput label="Latitude" value={form.latitude} onChange={(value) => setForm((current) => ({ ...current, latitude: value }))} />
            <ScopeInput label="Longitude" value={form.longitude} onChange={(value) => setForm((current) => ({ ...current, longitude: value }))} />
          </div>
          <label className="block text-sm font-semibold text-slate-700">
            Remarque
            <textarea
              className="mt-2 min-h-24 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-orange-500"
              onChange={(event) => setForm((current) => ({ ...current, remark: event.target.value }))}
              value={form.remark}
            />
          </label>
        </div>

        <button
          className="mt-6 w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!form.name.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
          type="button"
        >
          {mutation.isPending ? 'Creation...' : 'Créer le scope'}
        </button>
      </aside>
    </div>
  );
}

function ZoneFormDrawer({
  open,
  projectId,
  onCreated,
  onClose,
}: Readonly<{
  open: boolean;
  projectId: string;
  onCreated: () => void;
  onClose: () => void;
}>) {
  const { pushToast } = useToast();
  const [form, setForm] = useState({
    name: '',
    city: '',
    region: '',
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await authFetch('/api/negotiation/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: form.name,
          city: form.city,
          region: form.region,
        }),
      });
      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Impossible de creer la zone.');
      }
      return response.json() as Promise<unknown>;
    },
    onSuccess: () => {
      pushToast({ type: 'success', title: 'Zone creee', message: 'La zone est disponible dans le planning negociation.' });
      setForm({ name: '', city: '', region: '' });
      onCreated();
      onClose();
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Creation impossible',
        message: error instanceof Error ? error.message : 'La zone n a pas pu etre creee.',
      });
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/45">
      <aside className="custom-scrollbar h-full w-full max-w-xl overflow-y-auto bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Nouvelle zone</p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-950">Créer une zone</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              La zone regroupe les scopes du projet et sert ensuite à planifier les ressources négo.
            </p>
          </div>
          <button className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700" onClick={onClose} type="button">
            Fermer
          </button>
        </div>

        <div className="mt-6 space-y-4">
          <ScopeInput label="Nom de la zone" required value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
          <div className="grid gap-3 sm:grid-cols-2">
            <ScopeInput label="Commune" value={form.city} onChange={(value) => setForm((current) => ({ ...current, city: value }))} />
            <ScopeInput label="Région" value={form.region} onChange={(value) => setForm((current) => ({ ...current, region: value }))} />
          </div>
        </div>

        <button
          className="mt-6 w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!form.name.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
          type="button"
        >
          {mutation.isPending ? 'Creation...' : 'Créer la zone'}
        </button>
      </aside>
    </div>
  );
}

function ScopeImportModal({
  open,
  projectId,
  onImported,
  onClose,
}: Readonly<{
  open: boolean;
  projectId: string;
  onImported: () => void;
  onClose: () => void;
}>) {
  const { pushToast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{
    totalRows: number;
    validRows: number;
    invalidRows: number;
    detectedZones: number;
    createdZones: number;
    createdScopes: number;
    updatedScopes: number;
  } | null>(null);

  const importMutation = useMutation({
    mutationFn: async (mode: 'preview' | 'commit') => {
      if (!file) throw new Error('Choisis un fichier Excel.');
      const formData = new FormData();
      formData.set('projectId', projectId);
      formData.set('mode', mode);
      formData.set('file', file);
      const response = await authFetch('/api/negotiation/buildings/import', { method: 'POST', body: formData });
      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Import scopes impossible.');
      }
      return (await response.json()) as {
        totalRows: number;
        validRows: number;
        invalidRows: number;
        detectedZones: number;
        createdZones: number;
        createdScopes: number;
        updatedScopes: number;
      };
    },
    onSuccess: (data, mode) => {
      setPreview(data);
      pushToast({
        type: data.invalidRows > 0 ? 'warning' : 'success',
        title: mode === 'commit' ? 'Scopes importes' : 'Prévisualisation prête',
        message: `${data.validRows} scope(s) valide(s), ${data.detectedZones} zone(s), ${data.invalidRows} ligne(s) ignoree(s).`,
      });
      if (mode === 'commit') {
        onImported();
      }
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Import impossible',
        message: error instanceof Error ? error.message : 'Le fichier n a pas pu etre importe.',
      });
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[78] flex items-center justify-center bg-slate-950/55 p-4">
      <div className="w-full max-w-4xl rounded-[2rem] border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Import scopes</p>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950">Importer une base de scopes</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Télécharge le modèle, renseigne les scopes à visiter ou négocier, puis prévisualise avant import.
            </p>
          </div>
          <button className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" onClick={onClose} type="button">
            Fermer
          </button>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <article className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">1. Modèle</p>
            <p className="mt-2 text-sm text-slate-600">Le modèle contient les colonnes attendues pour les scopes.</p>
            <a className="mt-4 inline-flex rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800" href="/api/negotiation/buildings/import/template">
              Télécharger le modèle
            </a>
          </article>
          <article className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">2. Fichier</p>
            <input
              accept=".xlsx"
              className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
              }}
              type="file"
            />
            <button
              className="mt-4 rounded-full bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!file || importMutation.isPending}
              onClick={() => importMutation.mutate('preview')}
              type="button"
            >
              Prévisualiser
            </button>
          </article>
          <article className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">3. Import</p>
            <p className="mt-2 text-sm text-slate-600">Importer les lignes valides après contrôle.</p>
            <button
              className="mt-4 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!file || !preview || preview.validRows === 0 || importMutation.isPending}
              onClick={() => importMutation.mutate('commit')}
              type="button"
            >
              Importer les scopes
            </button>
          </article>
        </div>

        {preview ? (
          <div className="mt-6 grid gap-3 md:grid-cols-4">
            <MetricCard label="Total lignes" value={preview.totalRows} />
            <MetricCard label="Valides" value={preview.validRows} />
            <MetricCard label="Zones détectées" value={preview.detectedZones} />
            <MetricCard label="Ignorées" value={preview.invalidRows} />
            {preview.createdZones || preview.createdScopes || preview.updatedScopes ? (
              <>
                <MetricCard label="Zones créées" value={preview.createdZones} />
                <MetricCard label="Scopes créés" value={preview.createdScopes} />
                <MetricCard label="Scopes mis à jour" value={preview.updatedScopes} />
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ScopeInput({ label, value, onChange, required = false }: Readonly<{ label: string; value: string; onChange: (value: string) => void; required?: boolean }>) {
  return (
    <label className="block text-sm font-semibold text-slate-700">
      {label}
      {required ? <span className="text-orange-600"> *</span> : null}
      <input
        className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-orange-500"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function ImportMessages({ row }: Readonly<{ row: SiteImportPreviewRow }>) {
  const messages = [
    ...row.errors.map((error) => ({ tone: 'text-red-700', message: `${error.field}: ${error.message}` })),
    ...row.warnings.map((warning) => ({ tone: 'text-orange-700', message: `${warning.field}: ${warning.message}` })),
  ];

  if (messages.length === 0) {
    return <span className="text-slate-400">Aucun message</span>;
  }

  return (
    <div className="space-y-1">
      {messages.map((item, index) => (
        <p key={`${item.message}-${index}`} className={`text-xs font-semibold ${item.tone}`}>
          {item.message}
        </p>
      ))}
    </div>
  );
}

function SiteFormDrawer({
  open,
  initialSite,
  options,
  canManageRadius,
  currentProjectId,
  pending,
  onSubmit,
  onClose,
}: Readonly<{
  open: boolean;
  initialSite: ProjectSiteItem | null;
  options: ProjectFormOptionsResponse | null;
  canManageRadius: boolean;
  currentProjectId: string;
  pending: boolean;
  onSubmit: (values: SiteFormValues) => void;
  onClose: () => void;
}>) {
  const [values, setValues] = useState<SiteFormValues>(() => buildInitialSiteFormValues(initialSite, currentProjectId));
  const currentManagerIsOutsideGsOptions = Boolean(
    initialSite?.siteManagerId &&
      !(options?.siteManagers ?? []).some((manager) => manager.id === initialSite.siteManagerId),
  );
  const canEditRadius = canManageRadius || values.siteType === 'INTERVENTION_ZONE';

  useEffect(() => {
    setValues(buildInitialSiteFormValues(initialSite, currentProjectId));
  }, [currentProjectId, initialSite]);

  useEffect(() => {
    const defaultSiteManagerId = options?.siteManagers.at(0)?.id;
    if (initialSite || !defaultSiteManagerId) {
      return;
    }

    setValues((current) =>
      current.siteManagerId
        ? current
        : {
            ...current,
            siteManagerId: defaultSiteManagerId,
          },
    );
  }, [initialSite, options]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[76] flex justify-end bg-slate-950/45">
      <div className="custom-scrollbar h-full w-full max-w-2xl overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
              {initialSite ? 'Edition' : 'Creation'}
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950">
              {initialSite ? 'Modifier le chantier' : 'Nouveau chantier'}
            </h2>
          </div>
          <button
            className="rounded-full border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            Fermer
          </button>
        </div>

        <div className="mt-6 grid gap-4">
          <Field label="Projet">
            <select
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => setValues((current) => ({ ...current, projectId: event.target.value }))}
              value={values.projectId}
            >
              <option value="">Choisir un projet</option>
              {(options?.projects ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Nom du chantier">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
              value={values.name}
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Type de lieu">
              <select
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => {
                  const siteType = event.target.value as SiteType;
                  setValues((current) => ({
                    ...current,
                    siteType,
                    requiresClockIn: defaultRequiresClockInForSiteType(siteType),
                    ...(siteType === 'INTERVENTION_ZONE'
                      ? {
                          radiusKm: INTERVENTION_ZONE_RADIUS_KM,
                          geofenceType: 'RADIUS',
                          geofencePolygon: null,
                        }
                      : {}),
                  }));
                }}
                value={values.siteType}
              >
                <option value="WORKSITE">Chantier</option>
                <option value="INTERVENTION_ZONE">Zone d&apos;intervention</option>
                <option value="WAREHOUSE">Entrepôt</option>
                <option value="MATERIAL_PICKUP">Point d&apos;enlèvement matériel</option>
                <option value="OFFICE">Bureau</option>
                <option value="CLIENT_SITE">Site client</option>
                <option value="OTHER">Autre lieu</option>
              </select>
              {values.siteType === 'INTERVENTION_ZONE' ? (
                <p className="mt-2 text-xs font-semibold text-orange-600">
                  Pour les missions sans adresse client fixe, choisissez le centre de la ville ou du quartier et un rayon de pointage.
                </p>
              ) : null}
            </Field>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <label className="flex items-start gap-3 text-sm font-semibold text-slate-800">
                <input
                  checked={values.requiresClockIn}
                  className="mt-1 accent-orange-600"
                  onChange={(event) => setValues((current) => ({ ...current, requiresClockIn: event.target.checked }))}
                  type="checkbox"
                />
                <span>
                  Pointage GPS requis
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    Désactivez pour un bureau ou une tâche logistique qui ne doit pas apparaître dans le pointage.
                  </span>
                </span>
              </label>
            </div>
          </div>

          <SiteLocationPicker
            address={values.address}
            latitude={values.latitude}
            longitude={values.longitude}
            onChange={(nextValues) => setValues((current) => ({ ...current, ...nextValues }))}
            radiusKm={values.radiusKm}
            geofenceType={values.geofenceType}
            geofencePolygon={values.geofencePolygon}
          />

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Surface estimee (facultatif)">
              <input
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => setValues((current) => ({ ...current, area: event.target.value }))}
                placeholder="Non renseignée"
                type="number"
                value={values.area}
              />
            </Field>
            <Field label="Responsable chantier (GS)">
              <select
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => setValues((current) => ({ ...current, siteManagerId: event.target.value }))}
                value={values.siteManagerId}
              >
                {currentManagerIsOutsideGsOptions ? (
                  <option value={initialSite?.siteManagerId}>
                    Responsable actuel non-GS - selectionner un superviseur general
                  </option>
                ) : null}
                {(options?.siteManagers ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.firstName} {item.lastName}
                  </option>
                ))}
              </select>
              {currentManagerIsOutsideGsOptions ? (
                <p className="mt-2 text-xs font-semibold text-orange-600">
                  La nouvelle regle limite le responsable chantier aux superviseurs generaux actifs.
                </p>
              ) : null}
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Date de debut">
              <input
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => setValues((current) => ({ ...current, startDate: event.target.value }))}
                type="date"
                value={values.startDate}
              />
            </Field>
            <Field label="Date de fin">
              <input
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => setValues((current) => ({ ...current, endDate: event.target.value }))}
                type="date"
                value={values.endDate}
              />
            </Field>
          </div>

          <Field label="Description (facultatif)">
            <textarea
              className="min-h-28 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))}
              value={values.description}
            />
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Statut">
              <select
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => setValues((current) => ({ ...current, status: event.target.value as SiteStatus }))}
                value={values.status}
              >
                <option value="ACTIVE">Actif</option>
                <option value="ON_HOLD">En pause</option>
                <option value="COMPLETED">Termine</option>
              </select>
            </Field>
            <Field label="Rayon geofencing">
              <div className="space-y-2">
                <input
                  className="w-full accent-orange-600"
                  disabled={!canEditRadius}
                  max={10}
                  min={0.5}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, radiusKm: Number(event.target.value) }))
                  }
                  step={0.1}
                  type="range"
                  value={values.radiusKm}
                />
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>0.5 km</span>
                  <span className="font-semibold text-slate-900">{values.radiusKm.toFixed(1)} km</span>
                  <span>10 km</span>
                </div>
                {!canEditRadius ? (
                  <p className="text-xs text-orange-600">
                    Seuls DIRECTION et ADMIN peuvent modifier le rayon d&apos;un chantier classique.
                  </p>
                ) : null}
                {values.siteType === 'INTERVENTION_ZONE' ? (
                  <p className="text-xs text-emerald-700">
                    Zone d&apos;intervention : rayon ajustable pour couvrir la ville ou le quartier.
                  </p>
                ) : null}
              </div>
            </Field>
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <button
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            Annuler
          </button>
          <button
            className="rounded-full bg-slate-950 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending || !canSubmitSiteForm(values)}
            onClick={() => onSubmit(values)}
            type="button"
          >
            {pending ? 'Enregistrement...' : initialSite ? 'Mettre a jour' : 'Creer le chantier'}
          </button>
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

function MetricCard({ label, value }: Readonly<{ label: string; value: number | string }>) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-slate-950">{value}</p>
    </article>
  );
}

function LoadingCard({ message }: Readonly<{ message: string }>) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

function buildInitialSiteFormValues(site: ProjectSiteItem | null, currentProjectId: string): SiteFormValues {
  if (site) {
    return {
      projectId: site.projectId,
      name: site.name,
      address: site.address,
      siteType: site.siteType,
      requiresClockIn: site.requiresClockIn,
      latitude: String(site.latitude),
      longitude: String(site.longitude),
      radiusKm: site.radiusKm,
      geofenceType: site.geofenceType,
      geofencePolygon: site.geofencePolygon,
      description: site.description,
      status: site.status,
      area: String(site.area),
      startDate: site.startDate.slice(0, 10),
      endDate: site.endDate?.slice(0, 10) ?? '',
      siteManagerId: site.siteManagerId,
    };
  }

  return {
    projectId: currentProjectId,
    name: '',
    address: '',
    siteType: 'WORKSITE',
    requiresClockIn: true,
    latitude: '',
    longitude: '',
    radiusKm: 2,
    geofenceType: 'RADIUS',
    geofencePolygon: null,
    description: '',
    status: 'ACTIVE',
    area: '',
    startDate: '',
    endDate: '',
    siteManagerId: '',
  };
}

function buildCreateSiteMutationBody(values: SiteFormValues, canManageRadius: boolean): SiteMutationBody {
  const includeRadius = canManageRadius || values.siteType === 'INTERVENTION_ZONE';

  return {
    projectId: values.projectId,
    name: values.name,
    address: values.address,
    siteType: values.siteType,
    requiresClockIn: values.requiresClockIn,
    latitude: numberOrZero(values.latitude),
    longitude: numberOrZero(values.longitude),
    description: values.description,
    status: values.status,
    area: optionalNumberOrZero(values.area),
    startDate: values.startDate,
    endDate: values.endDate || null,
    siteManagerId: values.siteManagerId,
    geofenceType: values.geofenceType,
    geofencePolygon: values.geofenceType === 'POLYGON' ? values.geofencePolygon : null,
    ...(includeRadius ? { radiusKm: values.radiusKm } : {}),
  };
}

function buildPartialSiteMutationBody(values: SiteFormValues, initialSite: ProjectSiteItem, canManageRadius: boolean): SiteMutationBody {
  const includeRadius = canManageRadius || values.siteType === 'INTERVENTION_ZONE';
  const body: SiteMutationBody = {};
  setStringChange(body, 'projectId', values.projectId, initialSite.projectId);
  setStringChange(body, 'name', values.name, initialSite.name);
  setStringChange(body, 'address', values.address, initialSite.address);
  setStringChange(body, 'siteType', values.siteType, initialSite.siteType);
  setBooleanChange(body, 'requiresClockIn', values.requiresClockIn, initialSite.requiresClockIn);
  setNumberChange(body, 'latitude', numberOrZero(values.latitude), initialSite.latitude);
  setNumberChange(body, 'longitude', numberOrZero(values.longitude), initialSite.longitude);
  setStringChange(body, 'description', values.description, initialSite.description);
  setStringChange(body, 'status', values.status, initialSite.status);
  setNumberChange(body, 'area', optionalNumberOrZero(values.area), initialSite.area);
  setStringChange(body, 'startDate', values.startDate, initialSite.startDate.slice(0, 10));

  const nextEndDate = values.endDate || null;
  const previousEndDate = initialSite.endDate?.slice(0, 10) ?? null;
  if (nextEndDate !== previousEndDate) {
    body.endDate = nextEndDate;
  }

  setStringChange(body, 'siteManagerId', values.siteManagerId, initialSite.siteManagerId);
  setStringChange(body, 'geofenceType', values.geofenceType, initialSite.geofenceType);

  if (values.geofenceType !== initialSite.geofenceType || !samePolygon(values.geofencePolygon, initialSite.geofencePolygon)) {
    body.geofencePolygon = values.geofenceType === 'POLYGON' ? values.geofencePolygon : null;
  }

  if (includeRadius) {
    setNumberChange(body, 'radiusKm', values.radiusKm, initialSite.radiusKm);
  }

  return Object.keys(body).length ? body : { name: values.name };
}

function setStringChange<T extends keyof SiteMutationBody>(
  body: SiteMutationBody,
  key: T,
  nextValue: string,
  previousValue: string,
) {
  if (nextValue !== previousValue) {
    body[key] = nextValue as SiteMutationBody[T];
  }
}

function setNumberChange<T extends keyof SiteMutationBody>(
  body: SiteMutationBody,
  key: T,
  nextValue: number,
  previousValue: number,
) {
  if (Number.isFinite(nextValue) && Math.abs(nextValue - previousValue) > Number.EPSILON) {
    body[key] = nextValue as SiteMutationBody[T];
  }
}

function setBooleanChange<T extends keyof SiteMutationBody>(
  body: SiteMutationBody,
  key: T,
  nextValue: boolean,
  previousValue: boolean,
) {
  if (nextValue !== previousValue) {
    body[key] = nextValue as SiteMutationBody[T];
  }
}

function numberOrZero(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumberOrZero(value: string) {
  if (!value.trim()) {
    return 0;
  }

  return numberOrZero(value);
}

function formatEstimatedArea(value: number) {
  return value > 0 ? value.toFixed(2) : 'Non renseignée';
}

function samePolygon(left: SiteGeofencePolygon | null, right: SiteGeofencePolygon | null) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canSubmitSiteForm(values: SiteFormValues) {
  const latitude = Number(values.latitude);
  const longitude = Number(values.longitude);
  const area = Number(values.area);
  const hasValidGps =
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    (Math.abs(latitude) > 0.01 || Math.abs(longitude) > 0.01);

  return Boolean(
      values.projectId &&
      values.name.trim() &&
      (!values.area.trim() || (Number.isFinite(area) && area >= 0)) &&
      (!values.requiresClockIn || hasValidGps),
  );
}

function defaultRequiresClockInForSiteType(siteType: SiteType) {
  return siteType !== 'OFFICE';
}

function siteTypeLabel(siteType: SiteType) {
  switch (siteType) {
    case 'WORKSITE':
      return 'Chantier';
    case 'INTERVENTION_ZONE':
      return "Zone d'intervention";
    case 'WAREHOUSE':
      return 'Entrepôt';
    case 'MATERIAL_PICKUP':
      return "Point d'enlèvement";
    case 'OFFICE':
      return 'Bureau';
    case 'CLIENT_SITE':
      return 'Site client';
    case 'OTHER':
      return 'Autre lieu';
    default:
      return siteType;
  }
}

function humanizeProjectStatus(status: ProjectStatus) {
  switch (status) {
    case 'IN_PROGRESS':
      return 'En cours';
    case 'COMPLETED':
      return 'Termine';
    case 'ON_HOLD':
      return 'En pause';
    case 'ARCHIVED':
      return 'Archive';
    default:
      return status;
  }
}

function projectStatusTone(status: ProjectStatus) {
  switch (status) {
    case 'IN_PROGRESS':
      return 'success' as const;
    case 'COMPLETED':
      return 'neutral' as const;
    case 'ON_HOLD':
      return 'warning' as const;
    case 'ARCHIVED':
      return 'info' as const;
    default:
      return 'neutral' as const;
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(value));
}

function buildGpsMapUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps/search/api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}

async function safeJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
