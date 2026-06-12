'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type {
  MobilePresenceListResource,
  MobilePresenceListResponse,
  MobilePresenceListStatus,
} from '@/types/mobile-management-presences';

type ContextFilter = 'all' | 'TERRAIN' | 'OFFICE';
type StatusFilter = 'all' | 'present' | 'paused' | 'left' | 'absent' | 'late' | 'anomaly';

const contextFilters: { value: ContextFilter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'TERRAIN', label: 'Terrain' },
  { value: 'OFFICE', label: 'Bureau' },
];

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'present', label: 'Presents' },
  { value: 'paused', label: 'Pause' },
  { value: 'left', label: 'Sortis' },
  { value: 'absent', label: 'Absents' },
  { value: 'late', label: 'Retards' },
  { value: 'anomaly', label: 'Anomalies' },
];

type MobileManagementPresencesPageProps = Readonly<{
  user: WebSessionUser;
}>;

export function MobileManagementPresencesPage({ user }: MobileManagementPresencesPageProps) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [query, setQuery] = useState('');
  const [context, setContext] = useState<ContextFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [projectId, setProjectId] = useState('all');

  const requestPath = useMemo(() => {
    const params = new URLSearchParams({ date });
    if (query.trim()) params.set('q', query.trim());
    if (context !== 'all') params.set('context', context);
    if (status !== 'all') params.set('status', status);
    if (projectId !== 'all') params.set('projectId', projectId);
    return `/api/mobile/presences?${params.toString()}`;
  }, [context, date, projectId, query, status]);

  const presencesQuery = useQuery({
    queryKey: ['mobile-presence-list', requestPath],
    queryFn: async () => {
      const response = await authFetch(requestPath);
      if (!response.ok) {
        throw new Error(`Mobile presences request failed with status ${response.status}`);
      }
      return (await response.json()) as MobilePresenceListResponse;
    },
    staleTime: 30_000,
  });

  const data = presencesQuery.data;

  return (
    <div className="space-y-5 pb-20">
      <section className="rounded-3xl bg-slate-950 p-5 text-white shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-white/60">Liste de presence</p>
        <h1 className="mt-2 text-2xl font-black">Presences</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-white/70">
          Suivi bureau et terrain pour {user.firstName}.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Kpi label="Presents" value={data?.summary.present ?? 0} />
          <Kpi label="Bureau" value={data?.summary.office ?? 0} />
          <Kpi label="Retards" value={data?.summary.late ?? 0} />
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-panel">
        <input
          className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base font-semibold text-slate-950 outline-none focus:border-primary focus:bg-white"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher une ressource"
          type="search"
          value={query}
        />
        <input
          className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-base font-semibold text-slate-950 outline-none"
          onChange={(event) => setDate(event.target.value)}
          type="date"
          value={date}
        />
        <FilterBar items={contextFilters} onChange={setContext} value={context} />
        <FilterBar items={statusFilters} onChange={setStatus} value={status} />
        {data?.options.projects?.length ? (
          <select
            className="min-h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-900 outline-none"
            onChange={(event) => setProjectId(event.target.value)}
            value={projectId}
          >
            <option value="all">Tous les projets</option>
            {data.options.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.label}
              </option>
            ))}
          </select>
        ) : null}
      </section>

      {presencesQuery.isLoading ? <LoadingState /> : null}
      {presencesQuery.isError ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          Impossible de charger les presences. Verifiez la connexion puis reessayez.
        </section>
      ) : null}
      {data?.resources.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-center">
          <p className="text-sm font-black text-slate-900">Aucune presence</p>
          <p className="mt-2 text-sm font-semibold text-slate-500">Aucune ressource ne correspond aux filtres actifs.</p>
        </section>
      ) : null}
      {data?.resources.length ? (
        <section className="space-y-3">
          {data.resources.map((resource) => (
            <PresenceResourceCard key={resource.userId} resource={resource} />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function Kpi({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="rounded-2xl bg-white/10 p-3 text-center">
      <p className="text-xl font-black">{value}</p>
      <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-white/55">{label}</p>
    </div>
  );
}

function FilterBar<T extends string>({
  items,
  onChange,
  value,
}: Readonly<{
  items: { value: T; label: string }[];
  onChange: (value: T) => void;
  value: T;
}>) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {items.map((item) => (
        <button
          className={`min-h-10 shrink-0 rounded-xl border px-3 text-xs font-black ${
            value === item.value ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-600'
          }`}
          key={item.value}
          onClick={() => onChange(item.value)}
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function PresenceResourceCard({ resource }: Readonly<{ resource: MobilePresenceListResource }>) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-black text-slate-950">{resource.name}</p>
          <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">{resource.role}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.12em] ${statusTone(resource.status, resource.isLate)}`}>
          {resource.isLate ? 'Retard' : statusLabel(resource.status)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">{resource.contextLabel}</span>
        {resource.detailsCount > 1 ? (
          <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">{resource.detailsCount} positions</span>
        ) : null}
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-700">{resource.positionLabel}</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <TimeTile label="Arrivee" value={resource.arrivalAt ? formatTime(resource.arrivalAt) : '-'} />
        <TimeTile label="Depart" value={resource.departureAt ? formatTime(resource.departureAt) : '-'} />
        <TimeTile label="Temps" value={formatDuration(resource.durationSeconds)} />
      </div>
    </article>
  );
}

function TimeTile({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-xl bg-slate-50 p-2">
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-1 text-xs font-black text-slate-900">{value}</p>
    </div>
  );
}

function statusLabel(status: MobilePresenceListStatus) {
  if (status === 'PRESENT') return 'Present';
  if (status === 'PAUSED') return 'Pause';
  if (status === 'LEFT') return 'Sorti';
  if (status === 'ABSENT') return 'Absent';
  return 'Anomalie';
}

function statusTone(status: MobilePresenceListStatus, isLate: boolean) {
  if (isLate) return 'bg-orange-100 text-orange-700';
  if (status === 'PRESENT' || status === 'PAUSED') return 'bg-emerald-100 text-emerald-700';
  if (status === 'ABSENT') return 'bg-red-100 text-red-700';
  if (status === 'ANOMALY') return 'bg-amber-100 text-amber-700';
  return 'bg-slate-100 text-slate-700';
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function formatDuration(value: number | null) {
  if (value === null) return '-';
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return `${hours}h${String(minutes).padStart(2, '0')}`;
}

function LoadingState() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div className="h-28 animate-pulse rounded-2xl bg-slate-100" key={index} />
      ))}
    </div>
  );
}
