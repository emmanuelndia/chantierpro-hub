'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import type { PaginatedAdminDeletionLogsResponse } from '@/types/admin-logs';
import type { PaginatedUsersResponse } from '@/types/users';

export function AdminLogsPage() {
  const { pushToast } = useToast();
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [deletedBy, setDeletedBy] = useState('');

  const logsQuery = useQuery({
    queryKey: ['admin-logs', page, from, to, deletedBy],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      searchParams.set('page', String(page));
      if (from) {
        searchParams.set('from', `${from}T00:00:00.000Z`);
      }
      if (to) {
        searchParams.set('to', `${to}T23:59:59.999Z`);
      }
      if (deletedBy) {
        searchParams.set('deletedBy', deletedBy);
      }

      const response = await authFetch(`/api/admin/logs?${searchParams.toString()}`);
      if (!response.ok) {
        throw new Error(`Admin logs request failed with status ${response.status}`);
      }

      return (await response.json()) as PaginatedAdminDeletionLogsResponse;
    },
  });

  const usersQuery = useQuery({
    queryKey: ['admin-log-users'],
    queryFn: async () => {
      const response = await authFetch('/api/users?page=1&status=all');
      if (!response.ok) {
        throw new Error(`Users request failed with status ${response.status}`);
      }

      return (await response.json()) as PaginatedUsersResponse;
    },
  });

  async function handleExport() {
    try {
      const response = await authFetch('/api/admin/logs/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: from ? `${from}T00:00:00.000Z` : null,
          to: to ? `${to}T23:59:59.999Z` : null,
          deletedBy: deletedBy || null,
        }),
      });

      if (!response.ok) {
        const errorBody = (await safeJson(response)) as { message?: string } | null;
        throw new Error(errorBody?.message ?? 'Export impossible.');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = extractFileName(response.headers.get('content-disposition')) ?? 'admin-photo-logs.csv';
      anchor.click();
      URL.revokeObjectURL(url);
      pushToast({ type: 'success', title: 'Export CSV genere' });
    } catch (error) {
      pushToast({
        type: 'error',
        title: 'Export impossible',
        message: error instanceof Error ? error.message : "L'export n'a pas pu etre genere.",
      });
    }
  }

  function resetPage() {
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Administration</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Logs de suppression</h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Audit immuable des suppressions de photos, avec motif et auteur original.
            </p>
          </div>
          <button
            className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
            onClick={() => {
              void handleExport();
            }}
            type="button"
          >
            Export CSV
          </button>
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
        <div className="grid gap-4 lg:grid-cols-[0.8fr_0.8fr_1.2fr]">
          <Field label="Du">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setFrom(event.target.value);
                resetPage();
              }}
              type="date"
              value={from}
            />
          </Field>
          <Field label="Au">
            <input
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setTo(event.target.value);
                resetPage();
              }}
              type="date"
              value={to}
            />
          </Field>
          <Field label="Supprime par">
            <select
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:bg-white"
              onChange={(event) => {
                setDeletedBy(event.target.value);
                resetPage();
              }}
              value={deletedBy}
            >
              <option value="">Tous les utilisateurs</option>
              {(usersQuery.data?.items ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.firstName} {user.lastName} - {user.role.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </section>

      <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-panel">
        <div className="overflow-x-auto">
          <table className="min-w-[1000px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-5 py-4 font-semibold">Photo ID</th>
                <th className="px-5 py-4 font-semibold">Site</th>
                <th className="px-5 py-4 font-semibold">Supprime par</th>
                <th className="px-5 py-4 font-semibold">Date / Heure</th>
                <th className="px-5 py-4 font-semibold">Motif</th>
                <th className="px-5 py-4 font-semibold">Auteur original</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logsQuery.isLoading ? (
                <tr>
                  <td className="px-5 py-10 text-center text-slate-500" colSpan={6}>
                    Chargement des logs...
                  </td>
                </tr>
              ) : logsQuery.isError ? (
                <tr>
                  <td className="px-5 py-10" colSpan={6}>
                    <EmptyState description="Les logs d'administration n'ont pas pu etre charges." title="Logs indisponibles" />
                  </td>
                </tr>
              ) : (logsQuery.data?.items.length ?? 0) === 0 ? (
                <tr>
                  <td className="px-5 py-10" colSpan={6}>
                    <EmptyState description="Aucune suppression ne correspond a ces filtres." title="Aucun log" />
                  </td>
                </tr>
              ) : (
                logsQuery.data?.items.map((log) => (
                  <tr key={log.id} className="align-top hover:bg-slate-50">
                    <td className="px-5 py-4 font-mono text-xs text-slate-700">{log.photoId}</td>
                    <td className="px-5 py-4 font-semibold text-slate-950">{log.site.name}</td>
                    <td className="px-5 py-4 text-slate-700">
                      <div className="space-y-1">
                        <p className="font-semibold">
                          {log.deletedBy.firstName} {log.deletedBy.lastName}
                        </p>
                        <Badge tone="error">{log.deletedBy.role.replaceAll('_', ' ')}</Badge>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-slate-600">{formatDateTime(log.deletedAt)}</td>
                    <td className="px-5 py-4 text-slate-700">{log.reason}</td>
                    <td className="px-5 py-4 text-slate-700">
                      {log.originalAuthor.firstName} {log.originalAuthor.lastName}
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
          page={logsQuery.data?.page ?? page}
          totalPages={logsQuery.data?.totalPages ?? 1}
        />
      </section>
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
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-sm text-slate-500">
      <p>
        Page {page} / {totalPages}
      </p>
      <div className="flex gap-2">
        <button className="rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" disabled={page <= 1} onClick={onPrevious} type="button">
          Precedent
        </button>
        <button className="rounded-full border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" disabled={page >= totalPages} onClick={onNext} type="button">
          Suivant
        </button>
      </div>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function extractFileName(contentDisposition: string | null) {
  return contentDisposition?.match(/filename="([^"]+)"/)?.[1] ?? null;
}

async function safeJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
