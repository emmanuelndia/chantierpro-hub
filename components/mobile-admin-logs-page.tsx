'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { useToast } from '@/components/toast-provider';
import { authFetch } from '@/lib/auth/client-session';
import type { PaginatedAdminDeletionLogsResponse } from '@/types/admin-logs';
import type { PaginatedUsersResponse } from '@/types/users';

export function MobileAdminLogsPage() {
  const { pushToast } = useToast();
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [deletedBy, setDeletedBy] = useState('');

  const logsQuery = useQuery({
    queryKey: ['mobile-admin-logs', page, from, to, deletedBy],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page) });
      if (from) params.set('from', `${from}T00:00:00.000Z`);
      if (to) params.set('to', `${to}T23:59:59.999Z`);
      if (deletedBy) params.set('deletedBy', deletedBy);
      const response = await authFetch(`/api/admin/logs?${params}`);
      if (!response.ok) throw new Error('Chargement impossible.');
      return (await response.json()) as PaginatedAdminDeletionLogsResponse;
    },
    staleTime: 30_000,
  });

  const usersQuery = useQuery({
    queryKey: ['mobile-admin-log-users'],
    queryFn: async () => {
      const response = await authFetch('/api/users?page=1&status=all&limit=200');
      if (!response.ok) throw new Error('Chargement utilisateurs impossible.');
      return (await response.json()) as PaginatedUsersResponse;
    },
    staleTime: 5 * 60_000,
  });

  async function handleExport() {
    try {
      const response = await authFetch('/api/admin/logs/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: from ? `${from}T00:00:00.000Z` : null,
          to: to ? `${to}T23:59:59.999Z` : null,
          deletedBy: deletedBy || null,
        }),
      });
      if (!response.ok) throw new Error((await readMessage(response)) ?? 'Export impossible.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileNameFrom(response.headers.get('content-disposition')) ?? 'admin-photo-logs.csv';
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

  return (
    <div className="space-y-4 pb-20">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Administration</p>
            <h1 className="mt-2 text-xl font-black text-slate-950">Logs de suppression</h1>
          </div>
          <button className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-bold text-white" onClick={() => void handleExport()} type="button">
            CSV
          </button>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
        <div className="grid grid-cols-2 gap-3">
          <DateField label="Du" value={from} onChange={(value) => { setFrom(value); setPage(1); }} />
          <DateField label="Au" value={to} onChange={(value) => { setTo(value); setPage(1); }} />
        </div>
        <SelectField label="Supprime par" value={deletedBy} onChange={(value) => { setDeletedBy(value); setPage(1); }}>
          <option value="">Tous les utilisateurs</option>
          {(usersQuery.data?.items ?? []).map((user) => (
            <option key={user.id} value={user.id}>
              {user.firstName} {user.lastName}
            </option>
          ))}
        </SelectField>
      </section>

      {logsQuery.isLoading ? <InfoPanel text="Chargement des logs..." /> : null}
      {logsQuery.isError ? <InfoPanel tone="error" text="Les logs sont indisponibles." /> : null}
      {!logsQuery.isLoading && !logsQuery.isError && (logsQuery.data?.items.length ?? 0) === 0 ? (
        <EmptyState title="Aucun log" description="Aucune suppression ne correspond a ces filtres." />
      ) : null}

      <section className="space-y-3">
        {logsQuery.data?.items.map((log) => (
          <article key={log.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-black text-slate-950">{log.photoFilename}</h2>
                <p className="mt-1 truncate text-sm font-semibold text-slate-500">{log.site.name}</p>
              </div>
              <span className="shrink-0 text-xs font-semibold text-slate-500">{formatDateTime(log.deletedAt)}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge tone="error">{formatRole(log.deletedBy.role)}</Badge>
              <span className="text-sm font-semibold text-slate-700">
                {log.deletedBy.firstName} {log.deletedBy.lastName}
              </span>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <LogDetail label="Motif" value={log.reason} />
              <LogDetail label="Auteur original" value={`${log.originalAuthor.firstName} ${log.originalAuthor.lastName}`} />
              <LogDetail label="Photo prise le" value={formatDateTime(log.photoTakenAt)} />
            </dl>
          </article>
        ))}
      </section>

      <Pagination page={logsQuery.data?.page ?? page} totalPages={logsQuery.data?.totalPages ?? 1} onPageChange={setPage} />
    </div>
  );
}

function DateField({ label, value, onChange }: Readonly<{ label: string; value: string; onChange: (value: string) => void }>) {
  return (
    <label className="space-y-2">
      <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <input className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm" type="date" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({ label, value, onChange, children }: Readonly<{ label: string; value: string; onChange: (value: string) => void; children: ReactNode }>) {
  return (
    <label className="block space-y-2">
      <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{label}</span>
      <select className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm" value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

function LogDetail({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{label}</dt>
      <dd className="mt-1 text-slate-700">{value}</dd>
    </div>
  );
}

function Pagination({ page, totalPages, onPageChange }: Readonly<{ page: number; totalPages: number; onPageChange: (page: number) => void }>) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="font-semibold text-slate-500">Page {page} / {totalPages}</span>
      <div className="flex gap-2">
        <button className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold disabled:opacity-40" disabled={page <= 1} onClick={() => onPageChange(page - 1)} type="button">Precedent</button>
        <button className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold disabled:opacity-40" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} type="button">Suivant</button>
      </div>
    </div>
  );
}

function InfoPanel({ text, tone = 'neutral' }: Readonly<{ text: string; tone?: 'neutral' | 'error' }>) {
  return <div className={`rounded-lg border p-4 text-sm font-semibold ${tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600'}`}>{text}</div>;
}

function formatRole(role: string) { return role.replaceAll('_', ' '); }
function formatDateTime(value: string) { return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function fileNameFrom(value: string | null) { return value?.match(/filename="([^"]+)"/)?.[1] ?? null; }
async function readMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message;
  } catch {
    return null;
  }
}
