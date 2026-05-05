'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { authFetch } from '@/lib/auth/client-session';
import type {
  TeamPresenceItem,
  TeamPresencesResponse,
  TeamPresenceStatusFilter,
  TeamPresenceTimelineItem,
} from '@/types/team-presences';

const REFRESH_INTERVAL_MS = 30_000;

const statusOptions: { value: TeamPresenceStatusFilter; label: string }[] = [
  { value: 'all', label: 'Tous' },
  { value: 'present', label: 'Presents' },
  { value: 'paused', label: 'En pause' },
  { value: 'departed', label: 'Partis' },
  { value: 'absent', label: 'Absents' },
];

export function TeamPresencesPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [siteId, setSiteId] = useState('');
  const [status, setStatus] = useState<TeamPresenceStatusFilter>('all');
  const [selectedItem, setSelectedItem] = useState<TeamPresenceItem | null>(null);

  const query = useQuery({
    queryKey: ['team-presences', date, siteId, status],
    queryFn: () => fetchTeamPresences({ date, siteId, status }),
    refetchInterval: REFRESH_INTERVAL_MS,
  });

  const data = query.data;
  const totals = useMemo(() => {
    return {
      present: data?.presentNow.length ?? 0,
      paused: data?.onPause.length ?? 0,
      departed: data?.departedToday.length ?? 0,
      absent: data?.absent.length ?? 0,
    };
  }, [data]);

  if (query.isError) {
    return (
      <EmptyState
        title="Presences equipe indisponibles"
        description="Les presences temps reel n'ont pas pu etre chargees pour le moment."
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">Presences equipe</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              Activite superviseurs terrain
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
              Suivi des arrivees, pauses, departs et rapports soumis sur le perimetre accessible.
            </p>
          </div>
          <Badge tone={query.isFetching ? 'warning' : 'info'}>
            {query.isFetching ? 'Actualisation...' : data ? `Maj ${formatTime(data.generatedAt)}` : 'Chargement'}
          </Badge>
        </div>
      </section>

      <FiltersBar
        date={date}
        siteId={siteId}
        status={status}
        sites={data?.sites ?? []}
        onDateChange={setDate}
        onSiteChange={setSiteId}
        onStatusChange={setStatus}
      />

      {query.isLoading ? <LoadingGrid /> : null}

      {data ? (
        <>
          <section className="grid gap-4 md:grid-cols-4">
            <MetricCard label="Presents" value={totals.present} tone="success" />
            <MetricCard label="En pause" value={totals.paused} tone="warning" />
            <MetricCard label="Partis" value={totals.departed} tone="neutral" />
            <MetricCard label="Absents" value={totals.absent} tone="error" />
          </section>

          <section className="grid gap-6 xl:grid-cols-3">
            <PresenceColumn
              emptyMessage="Aucun superviseur present maintenant."
              items={data.presentNow}
              onSelect={setSelectedItem}
              title="Presents maintenant"
              tone="success"
            />
            <PresenceColumn
              emptyMessage="Aucune pause active."
              items={data.onPause}
              onSelect={setSelectedItem}
              title="En pause"
              tone="warning"
            />
            <PresenceColumn
              emptyMessage="Aucun depart enregistre."
              items={data.departedToday}
              onSelect={setSelectedItem}
              title="Partis aujourd'hui"
              tone="neutral"
            />
          </section>

          <AbsentsPanel items={data.absent} onSelect={setSelectedItem} />

          {selectedItem ? (
            <SupervisorDetailPanel
              item={selectedItem}
              onClose={() => setSelectedItem(null)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

async function fetchTeamPresences(filters: {
  date: string;
  siteId: string;
  status: TeamPresenceStatusFilter;
}) {
  const searchParams = new URLSearchParams({
    date: filters.date,
    status: filters.status,
  });

  if (filters.siteId) {
    searchParams.set('siteId', filters.siteId);
  }

  const response = await authFetch(`/api/presences/equipe?${searchParams.toString()}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Team presences request failed with status ${response.status}`);
  }

  return (await response.json()) as TeamPresencesResponse;
}

function FiltersBar({
  date,
  siteId,
  status,
  sites,
  onDateChange,
  onSiteChange,
  onStatusChange,
}: Readonly<{
  date: string;
  siteId: string;
  status: TeamPresenceStatusFilter;
  sites: TeamPresencesResponse['sites'];
  onDateChange: (value: string) => void;
  onSiteChange: (value: string) => void;
  onStatusChange: (value: TeamPresenceStatusFilter) => void;
}>) {
  return (
    <section className="grid gap-4 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel lg:grid-cols-[1fr_1.2fr_1.6fr]">
      <label className="text-sm font-semibold text-slate-700">
        Date
        <input
          className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-500"
          onChange={(event) => onDateChange(event.target.value)}
          type="date"
          value={date}
        />
      </label>
      <label className="text-sm font-semibold text-slate-700">
        Chantier
        <select
          className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-orange-500"
          onChange={(event) => onSiteChange(event.target.value)}
          value={siteId}
        >
          <option value="">Tous les chantiers</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
      </label>
      <div>
        <p className="text-sm font-semibold text-slate-700">Statut</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {statusOptions.map((option) => (
            <button
              className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition ${
                status === option.value
                  ? 'border-slate-950 bg-slate-950 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              key={option.value}
              onClick={() => onStatusChange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: Readonly<{
  label: string;
  value: number;
  tone: 'success' | 'warning' | 'neutral' | 'error';
}>) {
  const toneClassName = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warning: 'border-orange-200 bg-orange-50 text-orange-900',
    neutral: 'border-slate-200 bg-white text-slate-900',
    error: 'border-red-200 bg-red-50 text-red-900',
  }[tone];

  return (
    <article className={`rounded-[2rem] border p-5 shadow-panel ${toneClassName}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70">{label}</p>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
    </article>
  );
}

function PresenceColumn({
  title,
  items,
  tone,
  emptyMessage,
  onSelect,
}: Readonly<{
  title: string;
  items: TeamPresenceItem[];
  tone: 'success' | 'warning' | 'neutral';
  emptyMessage: string;
  onSelect: (item: TeamPresenceItem) => void;
}>) {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <Badge tone={tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : 'neutral'}>
          {items.length}
        </Badge>
      </div>
      {items.length === 0 ? (
        <CompactEmptyState message={emptyMessage} />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <PresenceRow item={item} key={item.id} onSelect={onSelect} tone={tone} />
          ))}
        </div>
      )}
    </section>
  );
}

function PresenceRow({
  item,
  tone,
  onSelect,
}: Readonly<{
  item: TeamPresenceItem;
  tone: 'success' | 'warning' | 'neutral' | 'error';
  onSelect: (item: TeamPresenceItem) => void;
}>) {
  return (
    <button
      className="w-full rounded-3xl border border-slate-200 p-4 text-left transition hover:border-orange-200 hover:bg-orange-50/40"
      onClick={() => onSelect(item)}
      type="button"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-950">{item.supervisorName}</p>
          <p className="mt-1 truncate text-sm text-slate-500">{item.siteName}</p>
        </div>
        <Badge tone={tone === 'error' ? 'error' : tone === 'success' ? 'success' : tone === 'warning' ? 'warning' : 'neutral'}>
          {presenceBadgeLabel(item)}
        </Badge>
      </div>
      <div className="mt-4 space-y-1 text-sm text-slate-600">
        {item.arrivalAt ? <p>Arrivee: {formatTime(item.arrivalAt)}</p> : null}
        {item.departureAt ? <p>Depart: {formatTime(item.departureAt)}</p> : null}
        {item.currentPauseSeconds !== null ? <p>Pause: {formatDuration(item.currentPauseSeconds)}</p> : null}
        {item.effectiveDurationSeconds !== null ? <p>Temps effectif: {formatDuration(item.effectiveDurationSeconds)}</p> : null}
      </div>
    </button>
  );
}

function AbsentsPanel({
  items,
  onSelect,
}: Readonly<{
  items: TeamPresenceItem[];
  onSelect: (item: TeamPresenceItem) => void;
}>) {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-950">Superviseurs absents</h2>
        <Badge tone="error">{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <CompactEmptyState message="Aucun superviseur absent sur le perimetre filtre." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <PresenceRow item={item} key={item.id} onSelect={onSelect} tone="error" />
          ))}
        </div>
      )}
    </section>
  );
}

function SupervisorDetailPanel({
  item,
  onClose,
}: Readonly<{
  item: TeamPresenceItem;
  onClose: () => void;
}>) {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-orange-600">Detail superviseur</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-950">{item.supervisorName}</h2>
          <p className="mt-2 text-sm text-slate-500">{item.siteName}</p>
        </div>
        <button
          className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          onClick={onClose}
          type="button"
        >
          Fermer
        </button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <h3 className="text-lg font-semibold text-slate-950">Timeline du jour</h3>
          {item.timeline.length === 0 ? (
            <CompactEmptyState message="Aucun pointage valide pour cette date." />
          ) : (
            <ol className="mt-4 space-y-3">
              {item.timeline.map((entry) => (
                <TimelineRow entry={entry} key={entry.id} />
              ))}
            </ol>
          )}
        </div>
        <aside className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
          <h3 className="text-lg font-semibold text-slate-950">Rapport</h3>
          <div className="mt-4">
            <Badge tone={item.report.submitted ? 'success' : 'warning'}>
              {item.report.submitted ? 'Soumis' : 'Non soumis'}
            </Badge>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-600">
            {item.report.submittedAt
              ? `Rapport soumis le ${formatDateTime(item.report.submittedAt)}.`
              : "Aucun rapport n'est rattache a cette session pour le moment."}
          </p>
        </aside>
      </div>
    </section>
  );
}

function TimelineRow({ entry }: Readonly<{ entry: TeamPresenceTimelineItem }>) {
  return (
    <li className="rounded-3xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-semibold text-slate-950">{clockInTypeLabel(entry.type)}</p>
        <Badge tone={entry.type === 'DEPARTURE' ? 'neutral' : entry.type.includes('PAUSE') ? 'warning' : 'success'}>
          {formatTime(entry.timestampLocal)}
        </Badge>
      </div>
      {entry.comment ? <p className="mt-2 text-sm text-slate-500">{entry.comment}</p> : null}
    </li>
  );
}

function LoadingGrid() {
  return (
    <section className="grid gap-6 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
      ))}
    </section>
  );
}

function CompactEmptyState({ message }: Readonly<{ message: string }>) {
  return <p className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">{message}</p>;
}

function presenceBadgeLabel(item: TeamPresenceItem) {
  if (!item.arrivalAt) {
    return 'Absent';
  }

  if (item.currentPauseSeconds !== null) {
    return 'Pause';
  }

  if (item.departureAt) {
    return 'Parti';
  }

  return 'Present';
}

function clockInTypeLabel(type: TeamPresenceTimelineItem['type']) {
  switch (type) {
    case 'ARRIVAL':
      return 'Arrivee';
    case 'DEPARTURE':
      return 'Depart';
    case 'PAUSE_START':
      return 'Debut pause';
    case 'PAUSE_END':
      return 'Fin pause';
    case 'INTERMEDIATE':
      return 'Point intermediaire';
    default:
      return type;
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours <= 0) {
    return `${minutes} min`;
  }

  return `${hours}h${String(minutes).padStart(2, '0')}`;
}
