'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Role } from '@prisma/client';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import type { RhExportHistoryResponse, RhOptionsResponse } from '@/types/rh';

type RhExportPageProps = Readonly<{
  viewer: {
    role: Role;
  };
}>;

type ExportFormat = 'csv' | 'xlsx';

export function RhExportPage({ viewer }: RhExportPageProps) {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [scopeMode, setScopeMode] = useState<'all' | 'one'>('all');
  const [projectMode, setProjectMode] = useState<'all' | 'one'>('all');
  const [userId, setUserId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [from, setFrom] = useState(() => monthStartIso());
  const [to, setTo] = useState(() => todayIso());
  const [format, setFormat] = useState<ExportFormat>('csv');

  const optionsQuery = useQuery({
    queryKey: ['rh-options'],
    queryFn: async () => {
      const response = await authFetch('/api/rh/options');
      if (!response.ok) {
        throw new Error(`RH options request failed with status ${response.status}`);
      }

      return (await response.json()) as RhOptionsResponse;
    },
  });

  const historyQuery = useQuery({
    queryKey: ['rh-export-history'],
    queryFn: async () => {
      const response = await authFetch('/api/rh/exports/history');
      if (!response.ok) {
        throw new Error(`RH export history request failed with status ${response.status}`);
      }

      return (await response.json()) as RhExportHistoryResponse;
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const response = await authFetch('/api/rh/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          format,
          from: `${from}T00:00:00.000Z`,
          to: `${to}T23:59:59.999Z`,
          userId: scopeMode === 'one' ? userId : null,
          projectId: projectMode === 'one' ? projectId : null,
        }),
      });

      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'La generation de lexport RH a echoue.');
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition');
      const match = contentDisposition?.match(/filename="([^"]+)"/);
      const fileName = match?.[1] ?? `rh-export.${format}`;

      return {
        blob,
        fileName,
      };
    },
    onSuccess: async ({ blob, fileName }) => {
      triggerDownload(blob, fileName);
      await queryClient.invalidateQueries({ queryKey: ['rh-export-history'] });
      pushToast({
        type: 'success',
        title: 'Export genere',
      });
    },
    onError: (error) => {
      pushToast({
        type: 'error',
        title: 'Export impossible',
        message: error instanceof Error ? error.message : 'Lexport RH a echoue.',
      });
    },
  });

  const resources = useMemo(() => optionsQuery.data?.resources ?? [], [optionsQuery.data?.resources]);
  const projects = useMemo(() => optionsQuery.data?.projects ?? [], [optionsQuery.data?.projects]);

  function handleRedownload(downloadUrl: string | null) {
    if (!downloadUrl) {
      pushToast({
        type: 'warning',
        title: 'Export expire',
        message: 'Cet artefact nest plus disponible au telechargement.',
      });
      return;
    }

    window.location.href = downloadUrl;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">
              Export RH
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              Generer et suivre les exports
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Exporte les heures RH au format CSV ou XLSX et retrouve les 20 derniers artefacts pendant 24 h.
            </p>
          </div>
          <Badge tone="info">{viewer.role}</Badge>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
          <h2 className="text-xl font-semibold text-slate-950">Generation export</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Field label="Perimetre ressource">
              <select
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => setScopeMode(event.target.value as 'all' | 'one')}
                value={scopeMode}
              >
                <option value="all">Toutes les ressources</option>
                <option value="one">Une ressource</option>
              </select>
            </Field>
            <Field label="Perimetre projet">
              <select
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => setProjectMode(event.target.value as 'all' | 'one')}
                value={projectMode}
              >
                <option value="all">Tous les projets</option>
                <option value="one">Un projet</option>
              </select>
            </Field>
            <Field label="Ressource">
              <select
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={scopeMode !== 'one'}
                onChange={(event) => setUserId(event.target.value)}
                value={userId}
              >
                <option value="">Selectionner</option>
                {resources.map((resource) => (
                  <option key={resource.id} value={resource.id}>
                    {resource.label} - {resource.role}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Projet">
              <select
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={projectMode !== 'one'}
                onChange={(event) => setProjectId(event.target.value)}
                value={projectId}
              >
                <option value="">Selectionner</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Du">
              <input
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => setFrom(event.target.value)}
                type="date"
                value={from}
              />
            </Field>
            <Field label="Au">
              <input
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
                onChange={(event) => setTo(event.target.value)}
                type="date"
                value={to}
              />
            </Field>
            <Field label="Format">
              <div className="flex gap-3">
                <button
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    format === 'csv'
                      ? 'bg-slate-950 text-white'
                      : 'border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                  onClick={() => setFormat('csv')}
                  type="button"
                >
                  CSV
                </button>
                <button
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    format === 'xlsx'
                      ? 'bg-slate-950 text-white'
                      : 'border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                  onClick={() => setFormat('xlsx')}
                  type="button"
                >
                  XLSX
                </button>
              </div>
            </Field>
          </div>

          <div className="mt-8 flex justify-end">
            <button
              className="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                exportMutation.isPending ||
                !from ||
                !to ||
                (scopeMode === 'one' && !userId) ||
                (projectMode === 'one' && !projectId)
              }
              onClick={() => exportMutation.mutate()}
              type="button"
            >
              {exportMutation.isPending ? 'Generation en cours...' : 'Generer'}
            </button>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
          <h2 className="text-xl font-semibold text-slate-950">Regles</h2>
          <div className="mt-4 space-y-3 text-sm leading-7 text-slate-600">
            <p>Les exports sont telecharges immediatement apres generation.</p>
            <p>Un artefact est conserve 24 heures dans Supabase Storage prive.</p>
            <p>Au-dela de 24 heures, le statut passe a EXPIRE et le lien devient inactif.</p>
          </div>
        </section>
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">20 derniers exports</h2>
            <p className="mt-2 text-sm text-slate-500">
              Re-telechargement disponible pendant 24 heures.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {historyQuery.isLoading ? (
            <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              Chargement de lhistorique...
            </div>
          ) : (historyQuery.data?.items.length ?? 0) === 0 ? (
            <EmptyState
              description="Aucun export RH nest encore disponible."
              title="Historique vide"
            />
          ) : (
            historyQuery.data?.items.map((item) => (
              <article key={item.id} className="rounded-3xl border border-slate-200 p-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="font-semibold text-slate-950">
                        {item.fileName ?? `Export ${item.format.toUpperCase()}`}
                      </p>
                      <Badge tone={item.isAvailable ? 'success' : 'warning'}>
                        {item.isAvailable ? 'Disponible' : 'EXPIRE'}
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm text-slate-500">
                      {item.createdBy.firstName} {item.createdBy.lastName} ({item.createdBy.role}) • {item.rowCount} ligne(s)
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {formatDateTime(item.createdAt)} • du {formatDateOnly(item.from)} au {formatDateOnly(item.to)}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {item.projectId ? 'Projet cible' : 'Tous projets'} • {item.userId ? 'Ressource ciblee' : 'Toutes ressources'}
                    </p>
                  </div>
                  <button
                    className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!item.isAvailable}
                    onClick={() => handleRedownload(item.downloadUrl)}
                    type="button"
                  >
                    Re-telecharger
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  children,
}: Readonly<{
  label: string;
  children: ReactNode;
}>) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function monthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateOnly(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

async function safeJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
