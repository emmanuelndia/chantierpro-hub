'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectStatus, Role, SiteStatus } from '@prisma/client';
import { Badge } from '@/components/badge';
import { ConfirmModal } from '@/components/confirm-modal';
import { EmptyState } from '@/components/empty-state';
import { PhotoGallery } from '@/components/photo-gallery';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import type {
  GeocodingSearchResponse,
  ProjectDetail,
  ProjectFormOptionsResponse,
  ProjectPresenceSummary,
  ProjectSiteItem,
  ProjectTeamSummaryResponse,
} from '@/types/projects';

type ProjectDetailPageProps = Readonly<{
  projectId: string;
  viewer: {
    id: string;
    role: Role;
  };
}>;

type SiteFormValues = {
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  radiusKm: number;
  description: string;
  status: SiteStatus;
  area: string;
  startDate: string;
  endDate: string;
  siteManagerId: string;
};

export function ProjectDetailPage({ projectId, viewer }: ProjectDetailPageProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [activeTab, setActiveTab] = useState<'sites' | 'team' | 'presences' | 'photos'>('sites');
  const [siteDrawerOpen, setSiteDrawerOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<ProjectSiteItem | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

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

  const saveSiteMutation = useMutation({
    mutationFn: async (values: SiteFormValues) => {
      const body = {
        ...values,
        latitude: Number(values.latitude),
        longitude: Number(values.longitude),
        area: Number(values.area),
        endDate: values.endDate || null,
        ...(canManageRadius || editingSite
          ? {
              radiusKm: values.radiusKm,
            }
          : {}),
      };

      const response = await authFetch(editingSite ? `/api/sites/${editingSite.id}` : `/api/projects/${projectId}/sites`, {
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
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project-detail', projectId] });
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

  const project = projectQuery.data;
  const canManageRadius = viewer.role === 'DIRECTION' || viewer.role === 'ADMIN';

  const tabs = useMemo(
    () => [
      { id: 'sites', label: 'Sites' },
      { id: 'team', label: 'Equipe' },
      { id: 'presences', label: 'Presences' },
      { id: 'photos', label: 'Photos' },
    ] as const,
    [],
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
                {project.sitesCount} site(s) • {project.resourcesCount} ressource(s)
              </p>
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{project.name}</h1>
            <p className="mt-3 max-w-4xl text-sm leading-7 text-slate-600">{project.description}</p>
            <p className="mt-4 text-sm text-slate-500">
              {project.city} • {project.address} • {formatDate(project.startDate)} → {project.endDate ? formatDate(project.endDate) : 'Ouvert'}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              onClick={() => {
                setEditingSite(null);
                setSiteDrawerOpen(true);
              }}
              type="button"
            >
              Nouveau chantier
            </button>
            <button
              className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100"
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

      {activeTab === 'sites' ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {project.sites.length === 0 ? (
            <div className="xl:col-span-2">
              <EmptyState
                description="Ce projet n'a pas encore de chantier rattache. Cree le premier site pour commencer."
                title="Aucun chantier"
              />
            </div>
          ) : (
            project.sites.map((site) => (
              <article key={site.id} className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-xl font-semibold text-slate-950">{site.name}</h2>
                      <Badge tone={site.status === 'ACTIVE' ? 'success' : site.status === 'ON_HOLD' ? 'warning' : 'neutral'}>
                        {site.status}
                      </Badge>
                    </div>
                    <p className="mt-3 text-sm text-slate-500">{site.address}</p>
                    <p className="mt-2 text-xs uppercase tracking-[0.16em] text-slate-400">
                      Geofencing {site.radiusKm.toFixed(1)} km • Surface {site.area.toFixed(2)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                      href={`/web/sites/${site.id}/presences`}
                    >
                      Voir presences
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
                        <p className="font-semibold text-slate-950">
                          {item.firstName} {item.lastName}
                        </p>
                        <p className="text-sm text-slate-500">
                          {item.role} • {item.email}
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
                        {site.presentCount} ressource(s) sur site • {site.status}
                      </p>
                    </div>
                    <Link
                      className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                      href={`/web/sites/${site.id}/presences`}
                    >
                      Ouvrir le detail
                    </Link>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {site.workers.map((worker) => (
                      <Badge key={worker.userId} tone="success">
                        {worker.firstName} {worker.lastName}
                      </Badge>
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

      <SiteFormDrawer
        canManageRadius={canManageRadius}
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

function SiteFormDrawer({
  open,
  initialSite,
  options,
  canManageRadius,
  pending,
  onSubmit,
  onClose,
}: Readonly<{
  open: boolean;
  initialSite: ProjectSiteItem | null;
  options: ProjectFormOptionsResponse | null;
  canManageRadius: boolean;
  pending: boolean;
  onSubmit: (values: SiteFormValues) => void;
  onClose: () => void;
}>) {
  const [values, setValues] = useState<SiteFormValues>(() => buildInitialSiteFormValues(initialSite));
  const [addressQuery, setAddressQuery] = useState(initialSite?.address ?? '');

  useEffect(() => {
    setValues(buildInitialSiteFormValues(initialSite));
    setAddressQuery(initialSite?.address ?? '');
  }, [initialSite]);

  const addressSuggestionsQuery = useQuery({
    queryKey: ['mapbox-addresses', addressQuery],
    queryFn: async () => {
      const response = await authFetch(`/api/geocoding/search?q=${encodeURIComponent(addressQuery)}`);
      if (!response.ok) {
        throw new Error(`Geocoding request failed with status ${response.status}`);
      }
      return (await response.json()) as GeocodingSearchResponse;
    },
    enabled: open && addressQuery.trim().length >= 3,
  });

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
          <Field label="Nom du chantier">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
              value={values.name}
            />
          </Field>

          <Field label="Adresse">
            <div className="space-y-3">
              <input
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => {
                  setAddressQuery(event.target.value);
                  setValues((current) => ({ ...current, address: event.target.value }));
                }}
                value={addressQuery}
              />
              {addressSuggestionsQuery.data?.items.length ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                  {addressSuggestionsQuery.data.items.map((item) => (
                    <button
                      key={`${item.label}:${item.latitude}:${item.longitude}`}
                      className="flex w-full items-start rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                      onClick={() => {
                        setAddressQuery(item.label);
                        setValues((current) => ({
                          ...current,
                          address: item.label,
                          latitude: String(item.latitude),
                          longitude: String(item.longitude),
                        }));
                      }}
                      type="button"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </Field>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Latitude">
              <input
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => setValues((current) => ({ ...current, latitude: event.target.value }))}
                value={values.latitude}
              />
            </Field>
            <Field label="Longitude">
              <input
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => setValues((current) => ({ ...current, longitude: event.target.value }))}
                value={values.longitude}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Surface">
              <input
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => setValues((current) => ({ ...current, area: event.target.value }))}
                value={values.area}
              />
            </Field>
            <Field label="Responsable chantier">
              <select
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => setValues((current) => ({ ...current, siteManagerId: event.target.value }))}
                value={values.siteManagerId}
              >
                {(options?.siteManagers ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.firstName} {item.lastName}
                  </option>
                ))}
              </select>
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

          <Field label="Description">
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
                  disabled={!canManageRadius}
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
                {!canManageRadius ? (
                  <p className="text-xs text-orange-600">
                    Seuls DIRECTION et ADMIN peuvent modifier le rayon.
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

function buildInitialSiteFormValues(site: ProjectSiteItem | null): SiteFormValues {
  if (site) {
    return {
      name: site.name,
      address: site.address,
      latitude: String(site.latitude),
      longitude: String(site.longitude),
      radiusKm: site.radiusKm,
      description: site.description,
      status: site.status,
      area: String(site.area),
      startDate: site.startDate.slice(0, 10),
      endDate: site.endDate?.slice(0, 10) ?? '',
      siteManagerId: site.siteManagerId,
    };
  }

  return {
    name: '',
    address: '',
    latitude: '',
    longitude: '',
    radiusKm: 2,
    description: '',
    status: 'ACTIVE',
    area: '',
    startDate: '',
    endDate: '',
    siteManagerId: '',
  };
}

function canSubmitSiteForm(values: SiteFormValues) {
  return Boolean(
    values.name.trim() &&
      values.address.trim() &&
      values.latitude.trim() &&
      values.longitude.trim() &&
      values.description.trim() &&
      values.area.trim() &&
      values.startDate &&
      values.siteManagerId,
  );
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

async function safeJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
