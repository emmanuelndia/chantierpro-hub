'use client';

import { TeamStatus } from '@prisma/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import type { TeamDetail } from '@/types/teams';
import type { WebTeamDetailResponse, WebTeamFormOptionsResponse, WebTeamPayload } from '@/types/web-teams';

type WebTeamFormPageProps = Readonly<{
  mode: 'create' | 'edit';
  teamId?: string;
}>;

type TeamFormValues = {
  projectId: string;
  siteId: string;
  name: string;
  teamLeadId: string;
  status: TeamStatus;
};

const initialValues: TeamFormValues = {
  projectId: '',
  siteId: '',
  name: '',
  teamLeadId: '',
  status: TeamStatus.ACTIVE,
};

const inputClassName =
  'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-500 disabled:bg-slate-100 disabled:text-slate-500';

export function WebTeamFormPage({ mode, teamId }: WebTeamFormPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preferredProjectId = searchParams.get('projectId') ?? '';
  const preferredSiteId = searchParams.get('siteId') ?? '';
  const [values, setValues] = useState<TeamFormValues>(initialValues);
  const [formError, setFormError] = useState<string | null>(null);

  const optionsQuery = useQuery({
    queryKey: ['web-team-options'],
    queryFn: fetchOptions,
  });
  const detailQuery = useQuery({
    queryKey: ['web-team-detail', teamId],
    queryFn: () => fetchTeamDetail(teamId ?? ''),
    enabled: mode === 'edit' && Boolean(teamId),
  });

  const options = optionsQuery.data;
  const detail = detailQuery.data;
  const filteredSites = useMemo(() => {
    const sites = options?.sites ?? [];
    return values.projectId ? sites.filter((site) => site.projectId === values.projectId) : sites;
  }, [options?.sites, values.projectId]);

  useEffect(() => {
    if (!options) return;

    if (mode === 'edit' && detail) {
      setValues({
        projectId: detail.team.projectId,
        siteId: detail.team.siteId,
        name: detail.team.name,
        teamLeadId: detail.team.teamLeadId,
        status: detail.team.status,
      });
      return;
    }

    if (mode === 'create') {
      const siteFromQuery = preferredSiteId
        ? options.sites.find((site) => site.id === preferredSiteId)
        : null;
      const projectFromQuery = preferredProjectId
        ? options.projects.find((project) => project.id === preferredProjectId)
        : null;
      const projectId = siteFromQuery?.projectId ?? projectFromQuery?.id ?? options.projects.at(0)?.id ?? '';
      const siteId =
        siteFromQuery?.id ??
        options.sites.find((site) => site.projectId === projectId)?.id ??
        options.sites.at(0)?.id ??
        '';
      setValues((current) => ({
        ...current,
        projectId: current.projectId || (options.sites.find((site) => site.id === siteId)?.projectId ?? projectId),
        siteId: current.siteId || siteId,
        teamLeadId: current.teamLeadId || (options.teamLeads.at(0)?.id ?? ''),
      }));
    }
  }, [detail, mode, options, preferredProjectId, preferredSiteId]);

  const mutation = useMutation({
    mutationFn: async () => {
      const validationError = validate(values);
      setFormError(validationError);
      if (validationError) throw new Error(validationError);

      const payload: WebTeamPayload = {
        siteId: values.siteId,
        name: values.name,
        teamLeadId: values.teamLeadId,
        status: values.status,
      };
      const url = mode === 'edit' && teamId ? `/api/teams/web/${teamId}` : '/api/teams/web';
      const response = await authFetch(url, {
        method: mode === 'edit' ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as { team?: TeamDetail; message?: string } | null;
      if (!response.ok || !body?.team) {
        throw new Error(body?.message ?? "Impossible d'enregistrer l'equipe.");
      }
      return body.team;
    },
    onSuccess: (team) => router.push(`/web/teams/${team.id}`),
    onError: (error) => setFormError(error instanceof Error ? error.message : "Impossible d'enregistrer l'equipe."),
  });

  const isLoading = optionsQuery.isLoading || (mode === 'edit' && detailQuery.isLoading);
  const isError = optionsQuery.isError || (mode === 'edit' && detailQuery.isError) || !options;

  if (isLoading) return <LoadingState />;
  if (isError) return <section className="rounded-[2rem] border border-red-200 bg-red-50 p-6 font-semibold text-red-700">Impossible de charger le formulaire equipe.</section>;

  return (
    <form className="space-y-6" onSubmit={(event) => submit(event, mutation.mutate)}>
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">Equipes</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
          {mode === 'edit' ? "Modifier l'equipe" : 'Nouvelle equipe'}
        </h1>
      </section>

      {formError ? <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{formError}</section> : null}

      <section className="grid gap-5 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel lg:grid-cols-2">
        <Field label="Projet">
          <select
            className={inputClassName}
            disabled={mode === 'edit'}
            onChange={(event) => {
              const projectId = event.target.value;
              setValues((current) => ({
                ...current,
                projectId,
                siteId: options.sites.find((site) => site.projectId === projectId)?.id ?? '',
              }));
            }}
            value={values.projectId}
          >
            <option value="">Choisir</option>
            {options.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Chantier">
          <select className={inputClassName} disabled={mode === 'edit'} onChange={(event) => setValues((current) => ({ ...current, siteId: event.target.value }))} value={values.siteId}>
            <option value="">Choisir</option>
            {filteredSites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.projectName} - {site.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nom">
          <input className={inputClassName} onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))} value={values.name} />
        </Field>
        <Field label="Chef d'equipe">
          <select className={inputClassName} onChange={(event) => setValues((current) => ({ ...current, teamLeadId: event.target.value }))} value={values.teamLeadId}>
            <option value="">Choisir</option>
            {options.teamLeads.map((lead) => (
              <option key={lead.id} value={lead.id}>
                {lead.firstName} {lead.lastName} ({lead.role})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Statut">
          <select className={inputClassName} onChange={(event) => setValues((current) => ({ ...current, status: event.target.value as TeamStatus }))} value={values.status}>
            <option value={TeamStatus.ACTIVE}>Active</option>
            <option value={TeamStatus.INACTIVE}>Inactive</option>
          </select>
        </Field>
      </section>

      <div className="flex justify-end gap-3">
        <button className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700" onClick={() => router.push('/web/teams')} type="button">
          Annuler
        </button>
        <button className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white disabled:opacity-60" disabled={mutation.isPending} type="submit">
          {mutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </form>
  );
}

async function fetchOptions() {
  const response = await authFetch('/api/teams/web/options', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Team options request failed with status ${response.status}`);
  return (await response.json()) as WebTeamFormOptionsResponse;
}

async function fetchTeamDetail(teamId: string) {
  const response = await authFetch(`/api/teams/web/${teamId}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Team detail request failed with status ${response.status}`);
  return (await response.json()) as WebTeamDetailResponse;
}

function validate(values: TeamFormValues) {
  if (!values.projectId) return 'Projet requis.';
  if (!values.siteId) return 'Chantier requis.';
  if (values.name.trim().length < 3) return 'Nom requis, 3 caracteres minimum.';
  if (!values.teamLeadId) return "Chef d'equipe requis.";
  return null;
}

function submit(event: FormEvent<HTMLFormElement>, run: () => void) {
  event.preventDefault();
  run();
}

function Field({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <label className="text-sm font-semibold text-slate-700">
      {label}
      <div className="mt-2">{children}</div>
    </label>
  );
}

function LoadingState() {
  return <div className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />;
}
