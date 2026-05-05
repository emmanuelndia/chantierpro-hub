'use client';

import { ProjectStatus } from '@prisma/client';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import { useToast } from '@/components/toast-provider';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type { ProjectDetail, ProjectFormOptionsResponse, ProjectListItem } from '@/types/projects';

type MobileProjectFormMode = 'create' | 'edit';

type ProjectFormValues = {
  name: string;
  description: string;
  address: string;
  city: string;
  startDate: string;
  endDate: string;
  status: ProjectStatus;
  projectManagerId: string;
};

type ProjectFormErrors = Partial<Record<keyof ProjectFormValues | 'form', string>>;

type MobileProjectFormPageProps = Readonly<{
  mode: MobileProjectFormMode;
  user: WebSessionUser;
  projectId?: string;
}>;

type ProjectFormResponse = {
  project: ProjectDetail;
  options: ProjectFormOptionsResponse;
};

type ProjectMutationResponse = {
  project: ProjectDetail | ProjectListItem;
};

const initialValues: ProjectFormValues = {
  name: '',
  description: '',
  address: '',
  city: '',
  startDate: '',
  endDate: '',
  status: ProjectStatus.IN_PROGRESS,
  projectManagerId: '',
};

export function MobileProjectFormPage({ mode, user, projectId }: MobileProjectFormPageProps) {
  const router = useRouter();
  const { pushToast } = useToast();
  const [values, setValues] = useState<ProjectFormValues>({
    ...initialValues,
    projectManagerId: user.role === 'PROJECT_MANAGER' ? user.id : '',
  });
  const [errors, setErrors] = useState<ProjectFormErrors>({});

  const optionsQuery = useQuery({
    queryKey: ['mobile-project-form-options'],
    queryFn: async () => {
      const response = await authFetch('/api/mobile/projects/form-options');

      if (!response.ok) {
        throw new Error(`Project options request failed with status ${response.status}`);
      }

      return (await response.json()) as ProjectFormOptionsResponse;
    },
    enabled: mode === 'create',
    staleTime: 300_000,
  });

  const editQuery = useQuery({
    queryKey: ['mobile-project-form', projectId],
    queryFn: async () => {
      const response = await authFetch(`/api/mobile/projects/${encodeURIComponent(projectId ?? '')}/form`);

      if (!response.ok) {
        throw new Error(`Project form request failed with status ${response.status}`);
      }

      return (await response.json()) as ProjectFormResponse;
    },
    enabled: mode === 'edit' && Boolean(projectId),
    staleTime: 30_000,
  });

  const options = mode === 'edit' ? editQuery.data?.options : optionsQuery.data;
  const project = editQuery.data?.project ?? null;

  useEffect(() => {
    if (mode === 'edit' && project) {
      setValues({
        name: project.name,
        description: project.description,
        address: project.address,
        city: project.city,
        startDate: project.startDate.slice(0, 10),
        endDate: project.endDate?.slice(0, 10) ?? '',
        status: project.status,
        projectManagerId: project.projectManagerId,
      });
      return;
    }

    if (mode === 'create' && user.role === 'PROJECT_MANAGER') {
      setValues((current) => ({ ...current, projectManagerId: user.id }));
      return;
    }

    if (mode === 'create' && user.role === 'DIRECTION' && !values.projectManagerId) {
      const firstManagerId = optionsQuery.data?.projectManagers.at(0)?.id;

      if (firstManagerId) {
        setValues((current) => ({ ...current, projectManagerId: firstManagerId }));
      }
    }
  }, [mode, optionsQuery.data?.projectManagers, project, user.id, user.role, values.projectManagerId]);

  const mutation = useMutation({
    mutationFn: async (payload: ProjectFormValues) => {
      const response = await authFetch(
        mode === 'edit' && projectId
          ? `/api/mobile/projects/${encodeURIComponent(projectId)}`
          : '/api/mobile/projects',
        {
          method: mode === 'edit' ? 'PATCH' : 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...payload,
            endDate: payload.endDate || null,
          }),
        },
      );

      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Impossible de sauvegarder le projet.');
      }

      return (await response.json()) as ProjectMutationResponse;
    },
    onSuccess: (data, variables) => {
      // Validation de sécurité de l'ID du projet
      const projectId = data?.project?.id;
      
      if (!projectId || typeof projectId !== 'string') {
        console.error('Invalid project ID in response:', data);
        setErrors({
          form: 'Erreur lors de la création du projet. ID invalide reçu.',
        });
        return;
      }

      // Afficher un toast de succès
      const projectName = data?.project?.name || 'Projet';
      pushToast({
        title: 'Projet créé avec succès',
        description: `"${projectName}" a été créé et est maintenant disponible.`,
        tone: 'success',
      });

      // Redirection vers le détail du projet
      router.push(`/mobile/projects/${projectId}`);
    },
    onError: (error) => {
      setErrors({
        form: error instanceof Error ? error.message : 'Impossible de sauvegarder le projet.',
      });
    },
  });

  const loading = mode === 'edit' ? editQuery.isLoading : optionsQuery.isLoading;
  const loadError = mode === 'edit' ? editQuery.isError : optionsQuery.isError;
  const title = mode === 'edit' ? 'Modifier le projet' : 'Créer un projet';
  const submitLabel = mode === 'edit' ? 'Enregistrer les modifications' : 'Créer le projet';
  const managerOptions = useMemo(() => options?.projectManagers ?? [], [options?.projectManagers]);
  const managerLocked = user.role === 'PROJECT_MANAGER';

  const selectedManagerName = useMemo(() => {
    const manager = managerOptions.find((item) => item.id === values.projectManagerId);
    return manager ? `${manager.firstName} ${manager.lastName}` : `${user.firstName} ${user.lastName}`;
  }, [managerOptions, user.firstName, user.lastName, values.projectManagerId]);

  function updateValue<Key extends keyof ProjectFormValues>(key: Key, value: ProjectFormValues[Key]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors({});
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors = validateProjectForm(values);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    mutation.mutate(values);
  }

  return (
    <div className="space-y-5 pb-20">
      <section className="rounded-lg border border-primary/20 bg-primary/10 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
          Gestion projets
        </p>
        <h1 className="mt-2 text-2xl font-black text-slate-950">{title}</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
          Renseignez les informations opérationnelles du projet.
        </p>
      </section>

      {loading ? <ProjectFormLoadingState /> : null}

      {loadError ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          Impossible de charger le formulaire projet. Vérifiez votre accès puis réessayez.
        </section>
      ) : null}

      {!loading && !loadError ? (
        <form className="space-y-5" onSubmit={handleSubmit}>
          {errors.form ? (
            <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
              {errors.form}
            </section>
          ) : null}

          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
              Informations générales
            </h2>
            <TextField
              error={errors.name}
              label="Nom du projet"
              onChange={(value) => updateValue('name', value)}
              placeholder="Ex : Rénovation Rue de Lyon"
              required
              value={values.name}
            />
            <TextAreaField
              error={errors.description}
              label="Description"
              onChange={(value) => updateValue('description', value)}
              placeholder="Objectif, contraintes et périmètre du projet"
              required
              value={values.description}
            />
            <TextField
              error={errors.address}
              label="Adresse"
              onChange={(value) => updateValue('address', value)}
              placeholder="Adresse principale"
              required
              value={values.address}
            />
            <TextField
              error={errors.city}
              label="Ville"
              onChange={(value) => updateValue('city', value)}
              placeholder="Ville"
              required
              value={values.city}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
              Planning
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <TextField
                error={errors.startDate}
                label="Début"
                onChange={(value) => updateValue('startDate', value)}
                required
                type="date"
                value={values.startDate}
              />
              <TextField
                error={errors.endDate}
                label="Fin"
                onChange={(value) => updateValue('endDate', value)}
                type="date"
                value={values.endDate}
              />
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
              Pilotage
            </h2>
            <StatusPicker value={values.status} onChange={(value) => updateValue('status', value)} />
            {errors.status ? <FieldError text={errors.status} /> : null}

            {managerLocked ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  Chef de projet
                </p>
                <p className="mt-2 text-sm font-black text-slate-950">{selectedManagerName}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  Verrouillé sur votre compte.
                </p>
              </div>
            ) : (
              <label className="block">
                <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                  Chef de projet *
                </span>
                <select
                  className={`mt-2 min-h-12 w-full rounded-lg border bg-white px-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-primary ${
                    errors.projectManagerId ? 'border-red-300' : 'border-slate-200'
                  }`}
                  onChange={(event) => updateValue('projectManagerId', event.target.value)}
                  value={values.projectManagerId}
                >
                  <option value="">Sélectionner un chef de projet</option>
                  {managerOptions.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.firstName} {manager.lastName}
                    </option>
                  ))}
                </select>
                {errors.projectManagerId ? <FieldError text={errors.projectManagerId} /> : null}
              </label>
            )}
          </section>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              className="min-h-14 rounded-lg border border-slate-200 bg-white text-sm font-black text-slate-700 shadow-panel transition active:scale-[0.98]"
              onClick={() => router.back()}
              type="button"
            >
              Annuler
            </button>
            <button
              className="min-h-14 rounded-lg bg-primary text-sm font-black text-white shadow-panel transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={mutation.isPending}
              type="submit"
            >
              {mutation.isPending ? 'Enregistrement...' : submitLabel}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

export function MobileCreateProjectPage({ user }: Readonly<{ user: WebSessionUser }>) {
  return <MobileProjectFormPage mode="create" user={user} />;
}

function TextField({
  label,
  value,
  onChange,
  error,
  placeholder,
  required = false,
  type = 'text',
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  required?: boolean;
  type?: 'date' | 'text';
}>) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
        {label}
        {required ? ' *' : ''}
      </span>
      <input
        className={`mt-2 min-h-12 w-full rounded-lg border bg-white px-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-primary ${
          error ? 'border-red-300' : 'border-slate-200'
        }`}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
      {error ? <FieldError text={error} /> : null}
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  error,
  placeholder,
  required = false,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  required?: boolean;
}>) {
  return (
    <label className="block">
      <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
        {label}
        {required ? ' *' : ''}
      </span>
      <textarea
        className={`mt-2 min-h-28 w-full resize-none rounded-lg border bg-white px-3 py-3 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-primary ${
          error ? 'border-red-300' : 'border-slate-200'
        }`}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
      {error ? <FieldError text={error} /> : null}
    </label>
  );
}

function StatusPicker({
  value,
  onChange,
}: Readonly<{
  value: ProjectStatus;
  onChange: (value: ProjectStatus) => void;
}>) {
  const options = [
    { value: ProjectStatus.IN_PROGRESS, label: 'En cours' },
    { value: ProjectStatus.ON_HOLD, label: 'En pause' },
    { value: ProjectStatus.COMPLETED, label: 'Terminé' },
    { value: ProjectStatus.ARCHIVED, label: 'Archivé' },
  ];

  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Statut *</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {options.map((option) => (
          <button
            className={`min-h-12 rounded-lg border px-3 text-sm font-black transition active:scale-[0.98] ${
              value === option.value
                ? 'border-primary bg-primary text-white'
                : 'border-slate-200 bg-white text-slate-600'
            }`}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FieldError({ text }: Readonly<{ text: string }>) {
  return <p className="mt-1 text-xs font-bold text-red-600">{text}</p>;
}

function ProjectFormLoadingState() {
  return (
    <div className="space-y-4">
      <div className="h-24 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-40 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-32 animate-pulse rounded-lg bg-slate-100" />
    </div>
  );
}

function validateProjectForm(values: ProjectFormValues): ProjectFormErrors {
  const errors: ProjectFormErrors = {};

  if (!values.name.trim()) {
    errors.name = 'Le nom du projet est requis.';
  }

  if (!values.description.trim()) {
    errors.description = 'La description est requise.';
  }

  if (!values.address.trim()) {
    errors.address = 'L’adresse est requise.';
  }

  if (!values.city.trim()) {
    errors.city = 'La ville est requise.';
  }

  if (!values.startDate) {
    errors.startDate = 'La date de début est requise.';
  }

  if (values.startDate && values.endDate && new Date(values.endDate).getTime() <= new Date(values.startDate).getTime()) {
    errors.endDate = 'La date de fin doit être après la date de début.';
  }

  if (!values.projectManagerId) {
    errors.projectManagerId = 'Le chef de projet est requis.';
  }

  return errors;
}

async function safeJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
