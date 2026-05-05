'use client';

import { SiteStatus } from '@prisma/client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type { MobileSiteFormOptionsResponse, MobileSiteFormResponse } from '@/types/mobile-sites';
import type { SiteDetail } from '@/types/projects';

type MobileSiteFormMode = 'create' | 'edit';

type MobileSiteFormPageProps = Readonly<{
  mode: MobileSiteFormMode;
  user: WebSessionUser;
  siteId?: string;
}>;

type SiteFormValues = {
  projectId: string;
  name: string;
  address: string;
  description: string;
  latitude: string;
  longitude: string;
  radiusKm: string;
  area: string;
  status: SiteStatus;
  startDate: string;
  endDate: string;
  siteManagerId: string;
};

type SiteFormErrors = Partial<Record<keyof SiteFormValues | 'form', string>>;

type SiteMutationResponse = {
  site: SiteDetail;
};

const initialValues: SiteFormValues = {
  projectId: '',
  name: '',
  address: '',
  description: '',
  latitude: '',
  longitude: '',
  radiusKm: '2',
  area: '',
  status: SiteStatus.ACTIVE,
  startDate: '',
  endDate: '',
  siteManagerId: '',
};

const inputClass =
  'min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-900 outline-none focus:border-primary';

export function MobileSiteFormPage({ mode, user, siteId }: MobileSiteFormPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preferredProjectId = searchParams.get('projectId');
  const [values, setValues] = useState<SiteFormValues>(initialValues);
  const [errors, setErrors] = useState<SiteFormErrors>({});

  const optionsQuery = useQuery({
    queryKey: ['mobile-site-form-options'],
    queryFn: async () => {
      const response = await authFetch('/api/mobile/sites/form-options');

      if (!response.ok) {
        throw new Error(`Site form options request failed with status ${response.status}`);
      }

      return (await response.json()) as MobileSiteFormOptionsResponse;
    },
    enabled: mode === 'create',
    staleTime: 300_000,
  });

  const editQuery = useQuery({
    queryKey: ['mobile-site-form', siteId],
    queryFn: async () => {
      const response = await authFetch(`/api/mobile/sites/${encodeURIComponent(siteId ?? '')}/form`);

      if (!response.ok) {
        throw new Error(`Site form request failed with status ${response.status}`);
      }

      return (await response.json()) as MobileSiteFormResponse;
    },
    enabled: mode === 'edit' && Boolean(siteId),
    staleTime: 30_000,
  });

  const options = mode === 'edit' ? editQuery.data?.options : optionsQuery.data;
  const site = editQuery.data?.site ?? null;
  const canEditRadius = user.role === 'DIRECTION';
  const isLoading = mode === 'edit' ? editQuery.isLoading : optionsQuery.isLoading;
  const isError = mode === 'edit' ? editQuery.isError : optionsQuery.isError;

  useEffect(() => {
    if (mode === 'edit' && site) {
      setValues({
        projectId: site.projectId,
        name: site.name,
        address: site.address,
        description: site.description,
        latitude: String(site.latitude),
        longitude: String(site.longitude),
        radiusKm: String(site.radiusKm),
        area: String(site.area),
        status: site.status,
        startDate: site.startDate.slice(0, 10),
        endDate: site.endDate?.slice(0, 10) ?? '',
        siteManagerId: site.siteManagerId,
      });
      return;
    }

    if (mode === 'create' && options) {
      const projectId = preferredProjectId && options.projects.some((project) => project.id === preferredProjectId)
        ? preferredProjectId
        : options.projects.at(0)?.id ?? '';
      const siteManagerId = options.siteManagers.at(0)?.id ?? '';

      setValues((current) => ({
        ...current,
        projectId: current.projectId || projectId,
        siteManagerId: current.siteManagerId || siteManagerId,
      }));
    }
  }, [mode, options, preferredProjectId, site]);

  const selectedProjectIsLocked = useMemo(() => mode === 'edit' || user.role === 'PROJECT_MANAGER', [mode, user.role]);

  const mutation = useMutation({
    mutationFn: async () => {
      const validation = validateValues(values, canEditRadius || mode === 'edit');
      setErrors(validation);

      if (Object.keys(validation).length > 0) {
        throw new Error('VALIDATION_FAILED');
      }

      const payload = buildPayload(values, canEditRadius || mode === 'edit');
      const response = await authFetch(
        mode === 'edit' && siteId ? `/api/mobile/sites/${encodeURIComponent(siteId)}` : '/api/mobile/sites',
        {
          method: mode === 'edit' ? 'PATCH' : 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );

      const body = (await response.json().catch(() => null)) as SiteMutationResponse | { message?: string } | null;

      if (!response.ok) {
        const message =
          body && 'message' in body && body.message ? body.message : 'Impossible d’enregistrer ce chantier.';
        setErrors({ form: message });
        throw new Error(message);
      }

      return body as SiteMutationResponse;
    },
    onSuccess: (data) => {
      router.push(`/mobile/sites/${encodeURIComponent(data.site.id)}`);
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'VALIDATION_FAILED') {
        return;
      }
    },
  });

  if (isLoading) {
    return <SiteFormLoadingState />;
  }

  if (isError || !options) {
    return (
      <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
        Impossible de charger le formulaire chantier.
      </section>
    );
  }

  return (
    <form className="space-y-5 pb-20" onSubmit={(event) => handleSubmit(event, mutation.mutate)}>
      <section className="rounded-lg border border-primary/20 bg-primary/10 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Gestion chantier</p>
        <h1 className="mt-2 text-2xl font-black text-slate-950">
          {mode === 'edit' ? 'Modifier le chantier' : 'Nouveau chantier'}
        </h1>
        <p className="mt-1 text-sm font-semibold text-slate-600">
          {mode === 'edit' ? 'Mettez à jour les informations du site.' : 'Créez un site rattaché à un projet.'}
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
            disabled={selectedProjectIsLocked}
            onChange={(event) => setValues((current) => ({ ...current, projectId: event.target.value }))}
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

        <Field label="Nom du chantier" error={errors.name}>
          <input
            className={inputClass}
            onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
            placeholder="Ex. Site A - Entrée principale"
            value={values.name}
          />
        </Field>

        <Field label="Adresse" error={errors.address}>
          <input
            className={inputClass}
            onChange={(event) => setValues((current) => ({ ...current, address: event.target.value }))}
            placeholder="Adresse du chantier"
            value={values.address}
          />
        </Field>

        <Field label="Description" error={errors.description}>
          <textarea
            className={`${inputClass} min-h-24 resize-none py-3`}
            onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))}
            placeholder="Zone, accès, contraintes principales"
            value={values.description}
          />
        </Field>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude" error={errors.latitude}>
            <input
              className={inputClass}
              inputMode="decimal"
              onChange={(event) => setValues((current) => ({ ...current, latitude: event.target.value }))}
              placeholder="5.3480"
              value={values.latitude}
            />
          </Field>
          <Field label="Longitude" error={errors.longitude}>
            <input
              className={inputClass}
              inputMode="decimal"
              onChange={(event) => setValues((current) => ({ ...current, longitude: event.target.value }))}
              placeholder="-4.0083"
              value={values.longitude}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Rayon GPS (km)" error={errors.radiusKm}>
            <input
              className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-500`}
              disabled={!canEditRadius}
              inputMode="decimal"
              onChange={(event) => setValues((current) => ({ ...current, radiusKm: event.target.value }))}
              value={values.radiusKm}
            />
          </Field>
          <Field label="Surface" error={errors.area}>
            <input
              className={inputClass}
              inputMode="decimal"
              onChange={(event) => setValues((current) => ({ ...current, area: event.target.value }))}
              placeholder="1200"
              value={values.area}
            />
          </Field>
        </div>

        {!canEditRadius ? (
          <p className="text-xs font-semibold text-slate-500">
            Le rayon GPS est verrouillé pour votre rôle. La validation serveur conserve cette règle.
          </p>
        ) : null}
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
        <Field label="Statut" error={errors.status}>
          <select
            className={inputClass}
            onChange={(event) => setValues((current) => ({ ...current, status: event.target.value as SiteStatus }))}
            value={values.status}
          >
            <option value={SiteStatus.ACTIVE}>Actif</option>
            <option value={SiteStatus.ON_HOLD}>En pause</option>
            <option value={SiteStatus.COMPLETED}>Terminé</option>
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date début" error={errors.startDate}>
            <input
              className={inputClass}
              onChange={(event) => setValues((current) => ({ ...current, startDate: event.target.value }))}
              type="date"
              value={values.startDate}
            />
          </Field>
          <Field label="Date fin" error={errors.endDate}>
            <input
              className={inputClass}
              onChange={(event) => setValues((current) => ({ ...current, endDate: event.target.value }))}
              type="date"
              value={values.endDate}
            />
          </Field>
        </div>

        <Field label="Responsable chantier" error={errors.siteManagerId}>
          <select
            className={inputClass}
            onChange={(event) => setValues((current) => ({ ...current, siteManagerId: event.target.value }))}
            value={values.siteManagerId}
          >
            <option value="">Choisir un responsable</option>
            {options.siteManagers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.firstName} {manager.lastName}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <button
        className="flex min-h-14 w-full items-center justify-center rounded-lg bg-primary px-4 text-base font-black text-white shadow-panel disabled:cursor-not-allowed disabled:opacity-60"
        disabled={mutation.isPending}
        type="submit"
      >
        {mutation.isPending ? 'Enregistrement...' : mode === 'edit' ? 'Enregistrer' : 'Créer le chantier'}
      </button>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: Readonly<{
  label: string;
  error?: string;
  children: ReactNode;
}>) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      {children}
      {error ? <span className="block text-xs font-bold text-red-600">{error}</span> : null}
    </label>
  );
}

function SiteFormLoadingState() {
  return (
    <div className="space-y-5 pb-20">
      <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-80 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-64 animate-pulse rounded-lg bg-slate-100" />
    </div>
  );
}

function handleSubmit(event: FormEvent<HTMLFormElement>, submit: () => void) {
  event.preventDefault();
  submit();
}

function validateValues(values: SiteFormValues, radiusRequired: boolean): SiteFormErrors {
  const nextErrors: SiteFormErrors = {};

  if (!values.projectId) nextErrors.projectId = 'Projet requis.';
  if (values.name.trim().length < 3) nextErrors.name = 'Nom requis, 3 caractères minimum.';
  if (!values.address.trim()) nextErrors.address = 'Adresse requise.';
  if (!values.description.trim()) nextErrors.description = 'Description requise.';
  if (!values.siteManagerId) nextErrors.siteManagerId = 'Responsable requis.';
  if (!values.startDate) nextErrors.startDate = 'Date de début requise.';

  const latitude = Number(values.latitude);
  const longitude = Number(values.longitude);
  const area = Number(values.area);
  const radiusKm = Number(values.radiusKm);

  if (!Number.isFinite(latitude)) nextErrors.latitude = 'Latitude invalide.';
  if (!Number.isFinite(longitude)) nextErrors.longitude = 'Longitude invalide.';
  if (!Number.isFinite(area) || area <= 0) nextErrors.area = 'Surface invalide.';

  if (radiusRequired && (!Number.isFinite(radiusKm) || radiusKm < 0.5 || radiusKm > 10)) {
    nextErrors.radiusKm = 'Rayon entre 0.5 et 10 km.';
  }

  if (values.endDate && values.startDate && new Date(values.endDate).getTime() <= new Date(values.startDate).getTime()) {
    nextErrors.endDate = 'La date de fin doit être après le début.';
  }

  return nextErrors;
}

function buildPayload(values: SiteFormValues, includeRadius: boolean) {
  return {
    projectId: values.projectId,
    name: values.name.trim(),
    address: values.address.trim(),
    description: values.description.trim(),
    latitude: Number(values.latitude),
    longitude: Number(values.longitude),
    ...(includeRadius ? { radiusKm: Number(values.radiusKm) } : {}),
    area: Number(values.area),
    status: values.status,
    startDate: values.startDate,
    endDate: values.endDate || null,
    siteManagerId: values.siteManagerId,
  };
}
