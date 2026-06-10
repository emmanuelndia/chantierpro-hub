'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import type { OfficeLocationItem, OfficeLocationsResponse } from '@/types/office-locations';

type FormState = {
  id: string | null;
  name: string;
  address: string;
  city: string;
  latitude: string;
  longitude: string;
  radiusKm: string;
  isActive: boolean;
};

const emptyForm: FormState = {
  id: null,
  name: '',
  address: '',
  city: '',
  latitude: '',
  longitude: '',
  radiusKm: '0.5',
  isActive: true,
};

export function AdminOfficeLocationsPage() {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [form, setForm] = useState<FormState>(emptyForm);

  const officesQuery = useQuery({
    queryKey: ['admin-office-locations'],
    queryFn: async () => {
      const response = await authFetch('/api/admin/office-locations');
      if (!response.ok) {
        throw new Error(`Office locations failed with status ${response.status}`);
      }

      return (await response.json()) as OfficeLocationsResponse;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        address: form.address,
        city: form.city || null,
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
        radiusKm: Number(form.radiusKm),
        isActive: form.isActive,
      };

      const response = await authFetch(
        form.id ? `/api/admin/office-locations/${form.id}` : '/api/admin/office-locations',
        {
          method: form.id ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const body = (await safeJson(response)) as { message?: string } | null;
        throw new Error(body?.message ?? 'Enregistrement du bureau impossible.');
      }
    },
    onSuccess: async () => {
      setForm(emptyForm);
      await queryClient.invalidateQueries({ queryKey: ['admin-office-locations'] });
      pushToast({ type: 'success', title: 'Bureau enregistre' });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Bureau non enregistre',
        message: error instanceof Error ? error.message : 'Verifiez les champs.',
      });
    },
  });

  const canSubmit =
    form.name.trim() &&
    form.address.trim() &&
    Number.isFinite(Number(form.latitude)) &&
    Number.isFinite(Number(form.longitude)) &&
    Number(form.radiusKm) > 0;

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Administration</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Bureaux de pointage</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
          Cree les bureaux autorises au pointage quotidien. Les utilisateurs internes choisissent un bureau actif avant de pointer.
        </p>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
          <h2 className="text-xl font-semibold text-slate-950">{form.id ? 'Modifier bureau' : 'Nouveau bureau'}</h2>
          <div className="mt-5 grid gap-4">
            <Field label="Nom">
              <input className={inputClassName} value={form.name} onChange={(event) => updateForm('name', event.target.value)} />
            </Field>
            <Field label="Adresse">
              <input className={inputClassName} value={form.address} onChange={(event) => updateForm('address', event.target.value)} />
            </Field>
            <Field label="Ville">
              <input className={inputClassName} value={form.city} onChange={(event) => updateForm('city', event.target.value)} />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Latitude">
                <input className={inputClassName} value={form.latitude} onChange={(event) => updateForm('latitude', event.target.value)} />
              </Field>
              <Field label="Longitude">
                <input className={inputClassName} value={form.longitude} onChange={(event) => updateForm('longitude', event.target.value)} />
              </Field>
            </div>
            <Field label="Rayon autorise (km)">
              <input className={inputClassName} value={form.radiusKm} onChange={(event) => updateForm('radiusKm', event.target.value)} />
            </Field>
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
              <input
                checked={form.isActive}
                onChange={(event) => updateForm('isActive', event.target.checked)}
                type="checkbox"
              />
              Bureau actif
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
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-slate-950">Bureaux</h2>
            <Badge tone="info">{officesQuery.data?.items.length ?? 0}</Badge>
          </div>

          <div className="mt-5 space-y-3">
            {officesQuery.isLoading ? <p className="text-sm text-slate-500">Chargement...</p> : null}
            {officesQuery.data?.items.length === 0 ? (
              <EmptyState title="Aucun bureau" description="Creez le premier bureau de pointage." />
            ) : null}
            {officesQuery.data?.items.map((office) => (
              <OfficeCard key={office.id} office={office} onEdit={() => setForm(fromOffice(office))} />
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

function OfficeCard({ office, onEdit }: { office: OfficeLocationItem; onEdit: () => void }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-950">{office.name}</h3>
          <p className="mt-1 text-sm text-slate-600">{office.address}</p>
          <p className="mt-2 text-xs font-semibold text-slate-500">
            {office.city ? `${office.city} - ` : ''}{office.latitude}, {office.longitude} - rayon {office.radiusKm} km
          </p>
        </div>
        <Badge tone={office.isActive ? 'success' : 'neutral'}>{office.isActive ? 'Actif' : 'Inactif'}</Badge>
      </div>
      <div className="mt-4 flex justify-end">
        <button className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm" onClick={onEdit} type="button">
          Modifier
        </button>
      </div>
    </article>
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

function fromOffice(office: OfficeLocationItem): FormState {
  return {
    id: office.id,
    name: office.name,
    address: office.address,
    city: office.city ?? '',
    latitude: String(office.latitude),
    longitude: String(office.longitude),
    radiusKm: String(office.radiusKm),
    isActive: office.isActive,
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
