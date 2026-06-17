'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import type {
  FleetVehicleImportResponse,
  FleetVehicleSummary,
  FleetVehiclesResponse,
} from '@/types/fleet-vehicles';

type FormState = {
  id: string | null;
  registrationNumber: string;
  brand: string;
  model: string;
  driverUserId: string;
  apprenticeUserId: string;
  startDate: string;
  isActive: boolean;
};

const emptyForm: FormState = {
  id: null,
  registrationNumber: '',
  brand: '',
  model: '',
  driverUserId: '',
  apprenticeUserId: '',
  startDate: new Date().toISOString().slice(0, 10),
  isActive: true,
};

export function FleetVehiclesPage() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FleetVehicleImportResponse | null>(null);

  const fleetQuery = useQuery({
    queryKey: ['fleet-vehicles'],
    queryFn: async () => {
      const response = await authFetch('/api/fleet/vehicles');
      if (!response.ok) {
        throw new Error(`Fleet vehicles failed with status ${response.status}`);
      }

      return (await response.json()) as FleetVehiclesResponse;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        registrationNumber: form.registrationNumber,
        brand: form.brand,
        model: form.model,
        driverUserId: form.driverUserId,
        apprenticeUserId: form.apprenticeUserId || null,
        startDate: form.startDate,
        isActive: form.isActive,
      };

      const response = await authFetch(form.id ? `/api/fleet/vehicles/${form.id}` : '/api/fleet/vehicles', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = (await safeJson(response)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Enregistrement vehicule impossible.');
      }
    },
    onSuccess: async () => {
      setForm(emptyForm);
      await queryClient.invalidateQueries({ queryKey: ['fleet-vehicles'] });
      pushToast({ type: 'success', title: 'Vehicule enregistre' });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Vehicule non enregistre',
        message: error instanceof Error ? error.message : 'Verifie les informations du vehicule.',
      });
    },
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      if (!importFile) {
        throw new Error('Choisis un fichier Excel avant la previsualisation.');
      }

      const formData = new FormData();
      formData.set('file', importFile);
      const response = await authFetch('/api/fleet/vehicles/import/preview', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const body = (await safeJson(response)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Previsualisation impossible.');
      }

      return (await response.json()) as FleetVehicleImportResponse;
    },
    onSuccess: (result) => {
      setPreview(result);
      pushToast({
        type: 'success',
        title: 'Previsualisation generee',
        message: `${result.validRows} ligne(s) valide(s), ${result.invalidRows} en erreur.`,
      });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Previsualisation impossible',
        message: error instanceof Error ? error.message : 'Verifie le fichier selectionne.',
      });
    },
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      if (!importFile) {
        throw new Error('Choisis un fichier Excel avant l import.');
      }

      const formData = new FormData();
      formData.set('file', importFile);
      const response = await authFetch('/api/fleet/vehicles/import/commit', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const body = (await safeJson(response)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Import impossible.');
      }

      return (await response.json()) as FleetVehicleImportResponse;
    },
    onSuccess: async (result) => {
      setPreview(result);
      setImportFile(null);
      await queryClient.invalidateQueries({ queryKey: ['fleet-vehicles'] });
      pushToast({
        type: 'success',
        title: 'Import termine',
        message: `${result.createdVehicles} vehicule(s) cree(s), ${result.updatedVehicles} mis a jour.`,
      });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Import impossible',
        message: error instanceof Error ? error.message : 'Corrige la previsualisation avant import.',
      });
    },
  });

  const availableResources = fleetQuery.data?.availableResources ?? [];
  const canSubmit =
    form.registrationNumber.trim() &&
    form.brand.trim() &&
    form.model.trim() &&
    form.driverUserId &&
    form.startDate &&
    form.driverUserId !== form.apprenticeUserId;
  const canImport = importFile && !previewMutation.isPending;
  const canCommit = Boolean(importFile && preview?.invalidRows === 0 && !commitMutation.isPending);

  const previewSummary = useMemo(() => {
    if (!preview) {
      return null;
    }

    return {
      lines: preview.totalRows,
      valid: preview.validRows,
      invalid: preview.invalidRows,
    };
  }, [preview]);

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Parc auto</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Vehicules parc auto</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
          Gere les vehicules, le chauffeur actuel et l apprenti rattache. Les informations vehicule restent separees des profils utilisateurs.
        </p>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <section className="space-y-6">
          <article className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
            <h2 className="text-xl font-semibold text-slate-950">{form.id ? 'Modifier vehicule' : 'Nouveau vehicule'}</h2>
            <div className="mt-5 grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Immatriculation">
                  <input
                    className={inputClassName}
                    value={form.registrationNumber}
                    onChange={(event) => updateForm('registrationNumber', event.target.value.toUpperCase())}
                  />
                </Field>
                <Field label="Date de rattachement">
                  <input
                    className={inputClassName}
                    type="date"
                    value={form.startDate}
                    onChange={(event) => updateForm('startDate', event.target.value)}
                  />
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Marque">
                  <input className={inputClassName} value={form.brand} onChange={(event) => updateForm('brand', event.target.value)} />
                </Field>
                <Field label="Modele">
                  <input className={inputClassName} value={form.model} onChange={(event) => updateForm('model', event.target.value)} />
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Chauffeur">
                  <select className={inputClassName} value={form.driverUserId} onChange={(event) => updateForm('driverUserId', event.target.value)}>
                    <option value="">Choisir une ressource parc auto</option>
                    {availableResources.map((resource) => (
                      <option key={resource.id} value={resource.id}>
                        {resource.firstName} {resource.lastName}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Apprenti">
                  <select
                    className={inputClassName}
                    value={form.apprenticeUserId}
                    onChange={(event) => updateForm('apprenticeUserId', event.target.value)}
                  >
                    <option value="">Aucun apprenti</option>
                    {availableResources.map((resource) => (
                      <option key={resource.id} value={resource.id}>
                        {resource.firstName} {resource.lastName}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                <input checked={form.isActive} type="checkbox" onChange={(event) => updateForm('isActive', event.target.checked)} />
                Vehicule actif
              </label>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              {form.id ? (
                <button
                  className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
                  onClick={() => setForm(emptyForm)}
                  type="button"
                >
                  Annuler
                </button>
              ) : null}
              <button
                className="rounded-full bg-slate-950 px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canSubmit || saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
                type="button"
              >
                {saveMutation.isPending ? 'Enregistrement...' : 'Enregistrer'}
              </button>
            </div>
          </article>

          <article className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">Import chauffeurs / apprentis</h2>
                <p className="mt-1 text-sm text-slate-600">Colonnes attendues : IMMAT, MARQUE, MODELE, CHAUFFEUR, APPRENTI.</p>
              </div>
              {previewSummary ? <Badge tone="info">{previewSummary.lines} ligne(s)</Badge> : null}
            </div>

            <div className="mt-5 grid gap-4">
              <Field label="Fichier Excel">
                <input
                  className={inputClassName}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] ?? null;
                    setImportFile(nextFile);
                    setPreview(null);
                  }}
                />
              </Field>

              {previewSummary ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <SummaryPill label="Valides" value={previewSummary.valid} tone="success" />
                  <SummaryPill label="Erreurs" value={previewSummary.invalid} tone={previewSummary.invalid > 0 ? 'error' : 'neutral'} />
                  <SummaryPill label="Total" value={previewSummary.lines} tone="info" />
                </div>
              ) : null}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canImport}
                onClick={() => previewMutation.mutate()}
                type="button"
              >
                {previewMutation.isPending ? 'Previsualisation...' : 'Previsualiser'}
              </button>
              <button
                className="rounded-full bg-slate-950 px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canCommit}
                onClick={() => commitMutation.mutate()}
                type="button"
              >
                {commitMutation.isPending ? 'Import...' : 'Importer'}
              </button>
            </div>

            {preview ? (
              <div className="mt-5 space-y-3">
                {preview.rows.slice(0, 8).map((row) => (
                  <article
                    className={`rounded-2xl border p-4 ${row.valid ? 'border-emerald-100 bg-emerald-50/50' : 'border-red-100 bg-red-50/60'}`}
                    key={row.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">{row.registrationNumber || 'Immatriculation manquante'}</p>
                        <p className="mt-1 text-sm text-slate-600">
                          {row.brand || 'Marque ?'} - {row.model || 'Modele ?'}
                        </p>
                        <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                          Chauffeur: {row.driverLabel || 'Non renseigne'}{row.apprenticeLabel ? ` - Apprenti: ${row.apprenticeLabel}` : ''}
                        </p>
                      </div>
                      <Badge tone={row.valid ? 'success' : 'error'}>{row.valid ? 'Valide' : 'Erreur'}</Badge>
                    </div>
                    {row.errors.length > 0 ? (
                      <ul className="mt-3 space-y-1 text-sm text-red-700">
                        {row.errors.map((error) => (
                          <li key={error}>- {error}</li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : null}
          </article>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-slate-950">Vehicules actifs et inactifs</h2>
            <Badge tone="info">{fleetQuery.data?.items.length ?? 0}</Badge>
          </div>

          <div className="mt-5 space-y-3">
            {fleetQuery.isLoading ? <p className="text-sm text-slate-500">Chargement...</p> : null}
            {fleetQuery.data?.items.length === 0 ? (
              <EmptyState title="Aucun vehicule" description="Ajoute le premier vehicule ou importe le fichier chauffeurs / apprentis." />
            ) : null}
            {fleetQuery.data?.items.map((vehicle) => (
              <FleetVehicleCard key={vehicle.id} vehicle={vehicle} onEdit={() => setForm(fromVehicle(vehicle))} />
            ))}
          </div>
        </section>
      </section>
    </div>
  );

  function updateForm<Key extends keyof FormState>(key: Key, value: FormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }
}

function FleetVehicleCard({ vehicle, onEdit }: { vehicle: FleetVehicleSummary; onEdit: () => void }) {
  const driver = vehicle.activeAssignment?.driver;
  const apprentice = vehicle.activeAssignment?.apprentice;

  return (
    <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-orange-600">{vehicle.registrationNumber}</p>
          <h3 className="mt-2 font-semibold text-slate-950">{vehicle.brand} {vehicle.model}</h3>
          <div className="mt-3 space-y-1 text-sm text-slate-600">
            <p>Chauffeur: {driver ? `${driver.firstName} ${driver.lastName}` : 'Aucun rattachement actif'}</p>
            <p>Apprenti: {apprentice ? `${apprentice.firstName} ${apprentice.lastName}` : 'Aucun'}</p>
          </div>
        </div>
        <Badge tone={vehicle.isActive ? 'success' : 'neutral'}>{vehicle.isActive ? 'Actif' : 'Inactif'}</Badge>
      </div>
      <div className="mt-4 flex justify-end">
        <button className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm" onClick={onEdit} type="button">
          Modifier
        </button>
      </div>
    </article>
  );
}

function SummaryPill({
  label,
  tone,
  value,
}: {
  label: string;
  tone: 'error' | 'info' | 'neutral' | 'success';
  value: number;
}) {
  const toneClasses =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : tone === 'error'
        ? 'border-red-200 bg-red-50 text-red-700'
        : tone === 'info'
          ? 'border-blue-200 bg-blue-50 text-blue-700'
          : 'border-slate-200 bg-slate-50 text-slate-700';

  return (
    <div className={`rounded-2xl border px-4 py-3 ${toneClasses}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.12em]">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function fromVehicle(vehicle: FleetVehicleSummary): FormState {
  return {
    id: vehicle.id,
    registrationNumber: vehicle.registrationNumber,
    brand: vehicle.brand,
    model: vehicle.model,
    driverUserId: vehicle.activeAssignment?.driver.id ?? '',
    apprenticeUserId: vehicle.activeAssignment?.apprentice?.id ?? '',
    startDate: vehicle.activeAssignment?.startDate.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    isActive: vehicle.isActive,
  };
}

async function safeJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

const inputClassName =
  'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white';
