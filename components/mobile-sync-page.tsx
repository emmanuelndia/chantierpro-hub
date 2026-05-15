'use client';

import { useEffect, useState } from 'react';
import {
  getMobileOfflineCache,
  getMobileOfflinePendingCounts,
  getMobileOfflineSyncLogs,
  syncMobileOfflineQueue,
  type MobileOfflinePendingCounts,
  type MobileOfflineSyncLog,
} from '@/lib/mobile-offline-db';
import { prepareMobileOfflineMode, type MobileOfflinePreparationResult } from '@/lib/mobile-offline-prepare';
import { useMobileNetworkState } from '@/hooks/use-mobile-network-state';

const emptyCounts: MobileOfflinePendingCounts = {
  clockIns: 0,
  comments: 0,
  photos: 0,
  reports: 0,
  sessionReports: 0,
  taskUpdates: 0,
};

export function MobileSyncPage() {
  const networkState = useMobileNetworkState();
  const [counts, setCounts] = useState<MobileOfflinePendingCounts>(emptyCounts);
  const [logs, setLogs] = useState<MobileOfflineSyncLog[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [preparation, setPreparation] = useState<MobileOfflinePreparationResult | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const [nextCounts, nextLogs, preparationMeta] = await Promise.all([
      getMobileOfflinePendingCounts(),
      getMobileOfflineSyncLogs(),
      getMobileOfflineCache<MobileOfflinePreparationResult>('offline-preparation-meta'),
    ]);
    setCounts(nextCounts);
    setLogs(nextLogs);
    setPreparation(preparationMeta?.payload ?? null);
  }

  async function syncNow() {
    setSyncing(true);

    try {
      await syncMobileOfflineQueue({ mode: 'manual' });
      await refresh();
    } finally {
      setSyncing(false);
    }
  }

  async function prepareOffline() {
    setPreparing(true);

    try {
      const result = await prepareMobileOfflineMode();
      setPreparation(result);
      await refresh();
    } finally {
      setPreparing(false);
    }
  }

  const canSync = networkState !== 'offline' && !syncing;
  const canPrepare = networkState !== 'offline' && !preparing;
  const totalPending =
    counts.clockIns +
    counts.comments +
    counts.photos +
    counts.reports +
    counts.sessionReports +
    counts.taskUpdates;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-panel">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-primary">Synchronisation</p>
        <h1 className="mt-2 text-2xl font-black text-slate-950">Mode offline</h1>
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3">
          <span className="text-sm font-bold text-slate-500">Etat reseau</span>
          <NetworkBadge state={networkState} />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <CountCard label="Pointages" value={counts.clockIns} />
        <CountCard label="Photos" value={counts.photos} />
        <CountCard label="Rapports" value={counts.reports} />
        <CountCard label="Commentaires" value={counts.comments} />
        <CountCard label="Rapports session" value={counts.sessionReports} />
        <CountCard label="Taches" value={counts.taskUpdates} />
      </section>

      <button
        className="flex min-h-14 w-full items-center justify-center rounded-lg bg-primary px-5 text-base font-black text-white disabled:opacity-45"
        disabled={!canSync}
        onClick={() => {
          void syncNow();
        }}
        type="button"
      >
        {syncing ? <Spinner className="h-5 w-5" /> : 'Synchroniser maintenant'}
      </button>

      <section className="rounded-lg border border-sky-200 bg-sky-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-slate-950">Preparation hors ligne</h2>
            <p className="mt-1 text-sm font-semibold text-slate-600">
              Prepare les ecrans et les donnees du jour avant une zone sans reseau.
            </p>
          </div>
          {preparation ? (
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black ${
                preparation.status === 'ready'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {preparation.status === 'ready' ? 'Pret' : 'Incomplet'}
            </span>
          ) : null}
        </div>

        {preparation ? (
          <p className="mt-3 text-xs font-semibold text-slate-600">
            Derniere preparation : {formatDateTime(preparation.preparedAt)} - {preparation.routesPrepared} pages,
            {' '}{preparation.dataPrepared.length} jeux de donnees.
          </p>
        ) : null}

        {preparation?.errors.length ? (
          <div className="mt-3 space-y-1">
            {preparation.errors.slice(0, 3).map((error) => (
              <p className="text-xs font-semibold text-orange-700" key={error}>
                {error}
              </p>
            ))}
          </div>
        ) : null}

        {preparation?.missingRoutes?.length ? (
          <p className="mt-3 text-xs font-semibold text-orange-700">
            {preparation.missingRoutes.length} page(s) encore absente(s) du cache de navigation.
          </p>
        ) : null}
        {preparation?.missingData?.length ? (
          <p className="mt-2 text-xs font-semibold text-orange-700">
            {preparation.missingData.length} jeu(x) de donnees terrain encore manquant(s).
          </p>
        ) : null}

        <button
          className="mt-4 flex min-h-12 w-full items-center justify-center rounded-lg bg-slate-950 px-4 py-3 text-sm font-black text-white disabled:opacity-45"
          disabled={!canPrepare}
          onClick={() => {
            void prepareOffline();
          }}
          type="button"
        >
          {preparing ? <Spinner className="h-5 w-5" /> : 'Preparer le mode hors ligne'}
        </button>
      </section>

      {networkState === 'offline' ? (
        <p className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm font-bold text-orange-800">
          La synchronisation sera relancee automatiquement au retour reseau.
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-slate-950">Historique</h2>
          <span className="text-sm font-bold text-slate-400">{totalPending} en attente</span>
        </div>
        {logs.length === 0 ? (
          <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm font-semibold text-slate-500">
            Aucune synchronisation recente.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {logs.map((log) => (
              <article className="rounded-lg border border-slate-200 p-3" key={log.id}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-black text-slate-950">{formatDateTime(log.finishedAt)}</span>
                  <SyncStatusBadge status={log.status} />
                </div>
                <p className="mt-2 text-xs font-semibold text-slate-500">
                  {log.counts.clockIns} pointages, {log.counts.photos} photos, {log.counts.reports + log.counts.sessionReports} rapports
                </p>
                {log.errors.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {log.errors.slice(0, 3).map((error, index) => (
                      <p className="text-xs font-semibold text-red-600" key={`${log.id}-${index}`}>
                        {error}
                      </p>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CountCard({ label, value }: Readonly<{ label: string; value: number }>) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 text-center shadow-sm">
      <div className="text-3xl font-black text-slate-950">{value}</div>
      <div className="mt-1 text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</div>
    </div>
  );
}

function NetworkBadge({ state }: Readonly<{ state: 'online' | 'degraded' | 'offline' }>) {
  const className = {
    online: 'bg-emerald-100 text-emerald-700',
    degraded: 'bg-yellow-100 text-yellow-800',
    offline: 'bg-orange-100 text-orange-800',
  }[state];
  const label = {
    online: 'Online',
    degraded: 'Degraded',
    offline: 'Offline',
  }[state];

  return <span className={`rounded-full px-3 py-1 text-xs font-black ${className}`}>{label}</span>;
}

function SyncStatusBadge({ status }: Readonly<{ status: MobileOfflineSyncLog['status'] }>) {
  const className = {
    success: 'bg-emerald-100 text-emerald-700',
    partial: 'bg-yellow-100 text-yellow-800',
    error: 'bg-red-100 text-red-700',
  }[status];

  return <span className={`rounded-full px-2.5 py-1 text-xs font-black ${className}`}>{status}</span>;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function Spinner({ className }: Readonly<{ className: string }>) {
  return (
    <svg aria-hidden="true" className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeLinecap="round" strokeWidth="4" />
    </svg>
  );
}
