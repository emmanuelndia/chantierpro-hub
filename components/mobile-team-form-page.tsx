'use client';

import { TeamStatus } from '@prisma/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type { MobileTeamFormOptionsResponse, MobileTeamFormResponse } from '@/types/mobile-teams';
import type { TeamDetail } from '@/types/teams';

type MobileTeamFormPageProps = Readonly<{
  mode: 'create' | 'edit';
  user: WebSessionUser;
  teamId?: string;
}>;

type TeamFormValues = {
  projectId: string;
  siteId: string;
  name: string;
  teamLeadId: string;
  status: TeamStatus;
};

type TeamFormPayload = Omit<TeamFormValues, 'projectId'>;
type TeamFormErrors = Partial<Record<keyof TeamFormValues | 'form', string>>;

type TeamMutationResponse = {
  team: TeamDetail;
};

const initialValues: TeamFormValues = {
  projectId: '',
  siteId: '',
  name: '',
  teamLeadId: '',
  status: TeamStatus.ACTIVE,
};

const inputClass =
  'min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-primary disabled:bg-slate-100 disabled:text-slate-500';

export function MobileTeamFormPage({ mode, user: _user, teamId }: MobileTeamFormPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preferredSiteId = searchParams.get('siteId');
  const preferredProjectId = searchParams.get('projectId');
  const [values, setValues] = useState<TeamFormValues>(initialValues);
  const [errors, setErrors] = useState<TeamFormErrors>({});

  const optionsQuery = useQuery({
    queryKey: ['mobile-team-form-options'],
    queryFn: async () => {
      const response = await authFetch('/api/mobile/teams/form-options');
      if (!response.ok) throw new Error(`Team form options request failed with status ${response.status}`);
      return (await response.json()) as MobileTeamFormOptionsResponse;
    },
    enabled: mode === 'create',
    staleTime: 300_000,
  });

  const editQuery = useQuery({
    queryKey: ['mobile-team-form', teamId],
    queryFn: async () => {
      const response = await authFetch(`/api/mobile/teams/${encodeURIComponent(teamId ?? '')}/form`);
      if (!response.ok) throw new Error(`Team form request failed with status ${response.status}`);
      return (await response.json()) as MobileTeamFormResponse;
    },
    enabled: mode === 'edit' && Boolean(teamId),
    staleTime: 30_000,
  });

  const options = mode === 'edit' ? editQuery.data?.options : optionsQuery.data;
  const team = editQuery.data?.team ?? null;
  const isLoading = mode === 'edit' ? editQuery.isLoading : optionsQuery.isLoading;
  const isError = mode === 'edit' ? editQuery.isError : optionsQuery.isError;
  const filteredSites = useMemo(() => {
    const sites = options?.sites ?? [];
    return values.projectId ? sites.filter((site) => site.projectId === values.projectId) : sites;
  }, [options?.sites, values.projectId]);
  const selectedSite = useMemo(
    () => options?.sites.find((site) => site.id === values.siteId) ?? null,
    [options?.sites, values.siteId],
  );

  useEffect(() => {
    if (mode === 'edit' && team && options) {
      const site = options.sites.find((item) => item.id === team.siteId);
      setValues({
        projectId: site?.projectId ?? '',
        siteId: team.siteId,
        name: team.name,
        teamLeadId: team.teamLeadId,
        status: team.status,
      });
      return;
    }

    if (mode === 'create' && options) {
      const projectId =
        preferredProjectId && options.projects.some((project) => project.id === preferredProjectId)
          ? preferredProjectId
          : options.projects.at(0)?.id ?? '';
      const siteId =
        preferredSiteId && options.sites.some((site) => site.id === preferredSiteId)
          ? preferredSiteId
          : options.sites.find((site) => site.projectId === projectId)?.id ?? options.sites.at(0)?.id ?? '';
      const selectedProjectId = options.sites.find((site) => site.id === siteId)?.projectId ?? projectId;
      const teamLeadId = options.teamLeads.at(0)?.id ?? '';

      setValues((current) => ({
        ...current,
        projectId: current.projectId || selectedProjectId,
        siteId: current.siteId || siteId,
        teamLeadId: current.teamLeadId || teamLeadId,
      }));
    }
  }, [mode, options, preferredProjectId, preferredSiteId, team]);

  const mutation = useMutation({
    mutationFn: async () => {
      const validation = validateValues(values);
      setErrors(validation);
      if (Object.keys(validation).length > 0) throw new Error('VALIDATION_FAILED');

      const payload: TeamFormPayload = {
        siteId: values.siteId,
        name: values.name,
        teamLeadId: values.teamLeadId,
        status: values.status,
      };
      const response = await authFetch(
        mode === 'edit' && teamId ? `/api/mobile/teams/${encodeURIComponent(teamId)}` : '/api/mobile/teams',
        {
          method: mode === 'edit' ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const body = (await response.json().catch(() => null)) as TeamMutationResponse | { message?: string } | null;

      if (!response.ok) {
        const message = body && 'message' in body && body.message ? body.message : "Impossible d'enregistrer l'équipe.";
        setErrors({ form: message });
        throw new Error(message);
      }

      return body as TeamMutationResponse;
    },
    onSuccess: (data) => router.push(`/mobile/teams/${encodeURIComponent(data.team.id)}`),
    onError: (error) => {
      if (error instanceof Error && error.message === 'VALIDATION_FAILED') return;
    },
  });

  if (isLoading) return <TeamFormLoadingState />;
  if (isError || !options) {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
        Impossible de charger le formulaire équipe.
      </section>
    );
  }

  return (
    <form className="space-y-5 pb-20" onSubmit={(event) => handleSubmit(event, mutation.mutate)}>
      <section className="rounded-lg border border-primary/20 bg-primary/10 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Gestion équipe</p>
        <h1 className="mt-2 text-2xl font-black text-slate-950">
          {mode === 'edit' ? "Modifier l'équipe" : 'Nouvelle équipe'}
        </h1>
        <p className="mt-1 text-sm font-semibold text-slate-600">
          {selectedSite ? `${selectedSite.projectName} · ${selectedSite.name}` : 'Affectation chantier et chef d’équipe'}
        </p>
      </section>

      {errors.form ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          {errors.form}
        </section>
      ) : null}

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
        <Field label="Projet" error={errors.projectId}>
          <select
            className={inputClass}
            disabled={mode === 'edit'}
            onChange={(event) => {
              const nextProjectId = event.target.value;
              const nextSiteId = options.sites.find((site) => site.projectId === nextProjectId)?.id ?? '';
              setValues((current) => ({ ...current, projectId: nextProjectId, siteId: nextSiteId }));
            }}
            value={values.projectId}
          >
            <option value="">Choisir un projet</option>
            {options.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Chantier" error={errors.siteId}>
          <select
            className={inputClass}
            disabled={mode === 'edit'}
            onChange={(event) => setValues((current) => ({ ...current, siteId: event.target.value }))}
            value={values.siteId}
          >
            <option value="">Choisir un chantier</option>
            {filteredSites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.projectName} - {site.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nom de l'équipe" error={errors.name}>
          <input
            className={inputClass}
            onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
            placeholder="Ex. Équipe Site A"
            value={values.name}
          />
        </Field>
        <Field label="Chef d'équipe" error={errors.teamLeadId}>
          <select
            className={inputClass}
            onChange={(event) => setValues((current) => ({ ...current, teamLeadId: event.target.value }))}
            value={values.teamLeadId}
          >
            <option value="">Choisir un chef</option>
            {options.teamLeads.map((lead) => (
              <option key={lead.id} value={lead.id}>
                {lead.firstName} {lead.lastName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Statut" error={errors.status}>
          <select
            className={inputClass}
            onChange={(event) => setValues((current) => ({ ...current, status: event.target.value as TeamStatus }))}
            value={values.status}
          >
            <option value={TeamStatus.ACTIVE}>Active</option>
            <option value={TeamStatus.INACTIVE}>Inactive</option>
          </select>
        </Field>
      </section>
      <button
        className="flex min-h-14 w-full items-center justify-center rounded-lg bg-primary px-4 text-base font-black text-white shadow-panel disabled:opacity-60"
        disabled={mutation.isPending}
        type="submit"
      >
        {mutation.isPending ? 'Enregistrement...' : mode === 'edit' ? 'Enregistrer' : "Créer l'équipe"}
      </button>
    </form>
  );
}

function Field({ label, error, children }: Readonly<{ label: string; error?: string; children: ReactNode }>) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      {children}
      {error ? <span className="block text-xs font-bold text-red-600">{error}</span> : null}
    </label>
  );
}

function TeamFormLoadingState() {
  return (
    <div className="space-y-5 pb-20">
      <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-80 animate-pulse rounded-lg bg-slate-100" />
    </div>
  );
}

function handleSubmit(event: FormEvent<HTMLFormElement>, submit: () => void) {
  event.preventDefault();
  submit();
}

function validateValues(values: TeamFormValues): TeamFormErrors {
  const errors: TeamFormErrors = {};
  if (!values.projectId) errors.projectId = 'Projet requis.';
  if (!values.siteId) errors.siteId = 'Chantier requis.';
  if (values.name.trim().length < 3) errors.name = 'Nom requis, 3 caractères minimum.';
  if (!values.teamLeadId) errors.teamLeadId = "Chef d'équipe requis.";
  return errors;
}
