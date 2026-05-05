'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectStatus, Role } from '@prisma/client';
import { Badge } from '@/components/badge';
import { ConfirmModal } from '@/components/confirm-modal';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import type { PaginatedProjectsResponse, ProjectDetail, ProjectFormOptionsResponse } from '@/types/projects';

type ProjectsListPageProps = Readonly<{
  scope: 'all' | 'mine';
  viewer: {
    id: string;
    role: Role;
    firstName: string;
    lastName: string;
  };
}>;

type ProjectFormValues = {
  name: string;
  description: string;
  address: string;
  city: string;
  startDate: string;
  endDate: string;
  projectManagerId: string;
  status: ProjectStatus;
};

type ProjectPayload = {
  project: ProjectDetail;
};

export function ProjectsListPage({ scope, viewer }: ProjectsListPageProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('ALL');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectDetail | null>(null);
  const [projectToArchive, setProjectToArchive] = useState<ProjectDetail | null>(null);

  const canCreateProject = viewer.role === 'PROJECT_MANAGER' || viewer.role === 'DIRECTION' || viewer.role === 'ADMIN';
  const pageTitle = scope === 'all' ? 'Tous les projets' : 'Mes projets';
  const pageDescription =
    scope === 'all'
      ? 'Pilote le portefeuille global avec filtres, pagination et actions rapides.'
      : 'Retrouve rapidement les projets qui te sont rattaches et ouvre chaque detail chantier.';

  const projectsQuery = useQuery({
    queryKey: ['projects-list', scope, page, search, status, periodFrom, periodTo],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      searchParams.set('page', String(page));
      if (search.trim()) {
        searchParams.set('search', search.trim());
      }
      if (status !== 'ALL') {
        searchParams.set('status', status);
      }
      if (periodFrom) {
        searchParams.set('periodFrom', periodFrom);
      }
      if (periodTo) {
        searchParams.set('periodTo', periodTo);
      }

      const response = await authFetch(`/api/projects?${searchParams.toString()}`);
      if (!response.ok) {
        throw new Error(`Projects request failed with status ${response.status}`);
      }

      return (await response.json()) as PaginatedProjectsResponse;
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
    enabled: canCreateProject,
  });

  const saveProjectMutation = useMutation({
    mutationFn: async (values: ProjectFormValues) => {
      const payload = {
        ...values,
        endDate: values.endDate || null,
      };

      const response = await authFetch(editingProject ? `/api/projects/${editingProject.id}` : '/api/projects', {
        method: editingProject ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Impossible de sauvegarder le projet.');
      }

      return (await response.json()) as ProjectPayload;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects-list'] });
      void queryClient.invalidateQueries({ queryKey: ['project-detail'] });
      setDrawerOpen(false);
      setEditingProject(null);
      pushToast({
        type: 'success',
        title: editingProject ? 'Projet mis a jour' : 'Projet cree',
      });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Sauvegarde impossible',
        message: error instanceof Error ? error.message : 'Verifie les donnees du projet puis reessaie.',
      });
    },
  });

  const archiveProjectMutation = useMutation({
    mutationFn: async (projectId: string) => {
      const response = await authFetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? "Impossible d'archiver le projet.");
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects-list'] });
      setProjectToArchive(null);
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

  const loading = projectsQuery.isLoading;

  const summary = useMemo(() => {
    const projects = projectsQuery.data?.items ?? [];
    const totalSites = projects.reduce((sum, project) => sum + project.sitesCount, 0);
    const totalResources = projects.reduce((sum, project) => sum + project.resourcesCount, 0);

    return {
      totalSites,
      totalResources,
    };
  }, [projectsQuery.data?.items]);

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
              Projets & chantiers
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{pageTitle}</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{pageDescription}</p>
          </div>
          {canCreateProject ? (
            <button
              className="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
              onClick={() => {
                setEditingProject(null);
                setDrawerOpen(true);
              }}
              type="button"
            >
              Nouveau projet
            </button>
          ) : null}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Projets visibles" value={projectsQuery.data?.totalItems ?? 0} />
        <MetricCard label="Nb sites sur cette page" value={summary.totalSites} />
        <MetricCard label="Nb ressources sur cette page" value={summary.totalResources} />
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr]">
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Recherche</span>
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Nom, ville, adresse..."
              value={search}
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Statut</span>
            <select
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              value={status}
            >
              <option value="ALL">Tous les statuts</option>
              <option value="IN_PROGRESS">En cours</option>
              <option value="COMPLETED">Termine</option>
              <option value="ON_HOLD">En pause</option>
              <option value="ARCHIVED">Archive</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Periode du</span>
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setPeriodFrom(event.target.value);
                setPage(1);
              }}
              type="date"
              value={periodFrom}
            />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Au</span>
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setPeriodTo(event.target.value);
                setPage(1);
              }}
              type="date"
              value={periodTo}
            />
          </label>
        </div>
      </section>

      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-panel">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-6 py-4 font-semibold">Nom</th>
                <th className="px-6 py-4 font-semibold">Dates</th>
                <th className="px-6 py-4 font-semibold">Nb sites</th>
                <th className="px-6 py-4 font-semibold">Nb ressources</th>
                <th className="px-6 py-4 font-semibold">Statut</th>
                <th className="px-6 py-4 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td className="px-6 py-10 text-center text-slate-500" colSpan={6}>
                    Chargement des projets...
                  </td>
                </tr>
              ) : (projectsQuery.data?.items.length ?? 0) === 0 ? (
                <tr>
                  <td className="px-6 py-10" colSpan={6}>
                    <EmptyState
                      description="Aucun projet ne correspond aux filtres actuels."
                      title="Pas de projet a afficher"
                    />
                  </td>
                </tr>
              ) : (
                projectsQuery.data?.items.map((project) => (
                  <tr key={project.id} className="hover:bg-slate-50">
                    <td className="px-6 py-5">
                      <div>
                        <p className="font-semibold text-slate-950">{project.name}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {project.city} • {project.address}
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-5 text-slate-600">
                      {formatDate(project.startDate)} → {project.endDate ? formatDate(project.endDate) : 'Ouvert'}
                    </td>
                    <td className="px-6 py-5 text-slate-600">
                      {project.sitesCount}
                      <span className="ml-2 text-xs text-slate-400">
                        {project.activeSitesCount} actif(s)
                      </span>
                    </td>
                    <td className="px-6 py-5 text-slate-600">{project.resourcesCount}</td>
                    <td className="px-6 py-5">
                      <Badge tone={projectStatusTone(project.status)}>{humanizeProjectStatus(project.status)}</Badge>
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex flex-wrap gap-2">
                        <Link
                          className="rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                          href={`/web/projects/${project.id}`}
                        >
                          Ouvrir
                        </Link>
                        {canCreateProject ? (
                          <button
                            className="rounded-full border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-semibold text-orange-700 transition hover:bg-orange-100"
                            onClick={() => {
                              setEditingProject(project as ProjectDetail);
                              setDrawerOpen(true);
                            }}
                            type="button"
                          >
                            Editer
                          </button>
                        ) : null}
                        {canCreateProject ? (
                          <button
                            className="rounded-full border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                            onClick={() => setProjectToArchive(project as ProjectDetail)}
                            type="button"
                          >
                            Archiver
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationBar
          onNext={() => setPage((current) => current + 1)}
          onPrevious={() => setPage((current) => Math.max(1, current - 1))}
          page={projectsQuery.data?.page ?? page}
          totalPages={projectsQuery.data?.totalPages ?? 1}
        />
      </section>

      <ProjectDrawer
        currentUser={viewer}
        initialProject={editingProject}
        onClose={() => {
          setDrawerOpen(false);
          setEditingProject(null);
        }}
        onSubmit={(values) => saveProjectMutation.mutate(values)}
        open={drawerOpen}
        options={formOptionsQuery.data ?? null}
        pending={saveProjectMutation.isPending}
      />

      <ConfirmModal
        cancelLabel="Annuler"
        confirmLabel="Archiver le projet"
        description={
          projectToArchive
            ? `Le projet "${projectToArchive.name}" sera passe au statut archive si aucun chantier actif n'y est rattache.`
            : ''
        }
        destructive
        onClose={() => setProjectToArchive(null)}
        onConfirm={() => {
          if (projectToArchive) {
            archiveProjectMutation.mutate(projectToArchive.id);
          }
        }}
        open={Boolean(projectToArchive)}
        title="Archiver ce projet ?"
      />
    </div>
  );
}

function ProjectDrawer({
  open,
  initialProject,
  options,
  currentUser,
  pending,
  onSubmit,
  onClose,
}: Readonly<{
  open: boolean;
  initialProject: ProjectDetail | null;
  options: ProjectFormOptionsResponse | null;
  currentUser: ProjectsListPageProps['viewer'];
  pending: boolean;
  onSubmit: (values: ProjectFormValues) => void;
  onClose: () => void;
}>) {
  const [values, setValues] = useState<ProjectFormValues>(() => buildInitialProjectFormValues(initialProject, currentUser));

  useEffect(() => {
    setValues(buildInitialProjectFormValues(initialProject, currentUser));
  }, [currentUser, initialProject]);

  if (!open) {
    return null;
  }

  const isProjectManager = currentUser.role === 'PROJECT_MANAGER';

  return (
    <div className="fixed inset-0 z-[75] flex justify-end bg-slate-950/45">
      <div className="custom-scrollbar h-full w-full max-w-2xl overflow-y-auto border-l border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
              {initialProject ? 'Edition' : 'Creation'}
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-slate-950">
              {initialProject ? 'Modifier le projet' : 'Nouveau projet'}
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
          <InputField label="Nom du projet" value={values.name} onChange={(value) => setValues((current) => ({ ...current, name: value }))} />
          <TextAreaField
            label="Description"
            value={values.description}
            onChange={(value) => setValues((current) => ({ ...current, description: value }))}
          />
          <InputField label="Adresse" value={values.address} onChange={(value) => setValues((current) => ({ ...current, address: value }))} />
          <InputField label="Ville" value={values.city} onChange={(value) => setValues((current) => ({ ...current, city: value }))} />

          <div className="grid gap-4 md:grid-cols-2">
            <InputField label="Date de debut" type="date" value={values.startDate} onChange={(value) => setValues((current) => ({ ...current, startDate: value }))} />
            <InputField label="Date de fin" type="date" value={values.endDate} onChange={(value) => setValues((current) => ({ ...current, endDate: value }))} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <SelectField
              disabled={isProjectManager}
              label="Chef de projet"
              onChange={(value) => setValues((current) => ({ ...current, projectManagerId: value }))}
              options={(options?.projectManagers ?? []).map((item) => ({
                value: item.id,
                label: `${item.firstName} ${item.lastName}`,
              }))}
              value={values.projectManagerId}
            />
            <SelectField
              label="Statut"
              onChange={(value) => setValues((current) => ({ ...current, status: value as ProjectStatus }))}
              options={[
                { value: 'IN_PROGRESS', label: 'En cours' },
                { value: 'COMPLETED', label: 'Termine' },
                { value: 'ON_HOLD', label: 'En pause' },
                { value: 'ARCHIVED', label: 'Archive' },
              ]}
              value={values.status}
            />
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
            disabled={pending || !canSubmitProjectForm(values)}
            onClick={() => onSubmit(values)}
            type="button"
          >
            {pending ? 'Enregistrement...' : initialProject ? 'Mettre a jour' : 'Creer le projet'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-panel">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
    </article>
  );
}

function PaginationBar({
  page,
  totalPages,
  onPrevious,
  onNext,
}: Readonly<{
  page: number;
  totalPages: number;
  onPrevious: () => void;
  onNext: () => void;
}>) {
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4 text-sm text-slate-500">
      <p>
        Page {page} / {totalPages}
      </p>
      <div className="flex gap-2">
        <button
          className="rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={page <= 1}
          onClick={onPrevious}
          type="button"
        >
          Precedent
        </button>
        <button
          className="rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={page >= totalPages}
          onClick={onNext}
          type="button"
        >
          Suivant
        </button>
      </div>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = 'text',
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'date' | 'text';
}>) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <input
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
}>) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <textarea
        className="min-h-28 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: Readonly<{
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}>) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <select
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white disabled:cursor-not-allowed disabled:opacity-70"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function buildInitialProjectFormValues(
  project: ProjectDetail | null,
  currentUser: ProjectsListPageProps['viewer'],
): ProjectFormValues {
  if (project) {
    return {
      name: project.name,
      description: project.description,
      address: project.address,
      city: project.city,
      startDate: project.startDate.slice(0, 10),
      endDate: project.endDate?.slice(0, 10) ?? '',
      projectManagerId: project.projectManagerId,
      status: project.status,
    };
  }

  return {
    name: '',
    description: '',
    address: '',
    city: '',
    startDate: '',
    endDate: '',
    projectManagerId: currentUser.role === 'PROJECT_MANAGER' ? currentUser.id : '',
    status: 'IN_PROGRESS',
  };
}

function canSubmitProjectForm(values: ProjectFormValues) {
  return Boolean(
    values.name.trim() &&
      values.description.trim() &&
      values.address.trim() &&
      values.city.trim() &&
      values.startDate &&
      values.projectManagerId,
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
