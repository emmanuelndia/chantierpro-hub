'use client';

import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { SignedImage } from '@/components/mobile/SignedImage';
import { authFetch } from '@/lib/auth/client-session';
import type {
  MobileHistoryPeriod,
  MobileHistoryResponse,
  MobileHistorySession,
  MobileHistorySessionStatus,
} from '@/types/mobile-history';
import type {
  ReportSummary,
  ReportDetail,
  MobileReportsHistoryResponse,
} from '@/types/mobile-history-reports';

const statusLabels: Record<MobileHistorySessionStatus, string> = {
  COMPLETE: 'Complete',
  PAUSE_ACTIVE: 'Pause en cours',
  IN_PROGRESS: 'En cours',
  INCOMPLETE: 'Incomplete',
};

export function MobileHistoryPage() {
  const [activeTab, setActiveTab] = useState<'sessions' | 'reports'>('sessions');
  const [period, setPeriod] = useState<MobileHistoryPeriod>('week');
  const [activeSession, setActiveSession] = useState<MobileHistorySession | null>(null);
  const [activeReport, setActiveReport] = useState<ReportDetail | null>(null);

  const historyQuery = useInfiniteQuery({
    queryKey: ['mobile-history', period],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const searchParams = new URLSearchParams({
        period,
        limit: '10',
      });

      if (pageParam) {
        searchParams.set('cursor', pageParam);
      }

      const response = await authFetch(`/api/mobile/history?${searchParams.toString()}`);

      if (!response.ok) {
        throw new Error(`Mobile history failed with status ${response.status}`);
      }

      return (await response.json()) as MobileHistoryResponse;
    },
    staleTime: 30_000,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const reportsQuery = useInfiniteQuery({
    queryKey: ['mobile-history-reports', period],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const searchParams = new URLSearchParams({
        period,
        limit: '10',
      });

      if (pageParam) {
        searchParams.set('cursor', pageParam);
      }

      const response = await authFetch(`/api/mobile/history/reports?${searchParams.toString()}`);

      if (!response.ok) {
        throw new Error(`Mobile reports history failed with status ${response.status}`);
      }

      return (await response.json()) as MobileReportsHistoryResponse;
    },
    staleTime: 30_000,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const pages = useMemo(() => historyQuery.data?.pages ?? [], [historyQuery.data?.pages]);
  const summary = pages[0]?.summary ?? {
    realDurationSeconds: 0,
    sessionsCount: 0,
    photosCount: 0,
  };
  const days = useMemo(() => pages.flatMap((page) => page.days), [pages]);

  const reportsPages = useMemo(() => reportsQuery.data?.pages ?? [], [reportsQuery.data?.pages]);
  const reports = useMemo(() => reportsPages.flatMap((page) => page.reports), [reportsPages]);
  const reportsStats = reportsPages[0]?.statistics ?? {
    reportsSubmittedThisMonth: 0,
    averageProgressDeclared: 0,
    totalReports: 0,
    reportsByStatus: {
      SUBMITTED: 0,
      REVIEWED: 0,
      VALIDATED: 0,
      SENT: 0,
    },
  };

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-primary/20 bg-primary/10 p-4">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
          Historique personnel
        </p>
        <h2 className="mt-2 text-2xl font-black text-slate-950">
          {activeTab === 'sessions' ? 'Mes sessions' : 'Mes rapports'}
        </h2>
      </section>

      {/* Onglets */}
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
        <TabButton 
          active={activeTab === 'sessions'} 
          label="Pointages" 
          onClick={() => setActiveTab('sessions')} 
        />
        <TabButton 
          active={activeTab === 'reports'} 
          label="Rapports" 
          onClick={() => setActiveTab('reports')} 
        />
      </div>

      {/* Période */}
      <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
        <PeriodButton active={period === 'week'} label="Semaine" onClick={() => setPeriod('week')} />
        <PeriodButton active={period === 'month'} label="Mois" onClick={() => setPeriod('month')} />
      </div>

      {/* Statistiques */}
      {activeTab === 'sessions' ? (
        <section className="grid grid-cols-3 gap-2">
          <SummaryTile label="Heures" value={formatHours(summary.realDurationSeconds)} />
          <SummaryTile label="Sessions" value={String(summary.sessionsCount)} />
          <SummaryTile label="Photos" value={String(summary.photosCount)} />
        </section>
      ) : (
        <section className="grid grid-cols-3 gap-2">
          <SummaryTile label="Ce mois" value={String(reportsStats.reportsSubmittedThisMonth)} />
          <SummaryTile label="Moyenne" value={`${Math.round(reportsStats.averageProgressDeclared)}%`} />
          <SummaryTile label="Total" value={String(reportsStats.totalReports)} />
        </section>
      )}

      {activeTab === 'sessions' ? (
        <>
          {historyQuery.isLoading ? <LoadingState /> : null}

          {historyQuery.isError ? (
            <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              Impossible de charger l&apos;historique des sessions.
            </section>
          ) : null}

          {!historyQuery.isLoading && days.length === 0 ? (
            <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <h3 className="text-lg font-black text-slate-950">Aucun historique</h3>
              <p className="mt-2 text-sm text-slate-500">Vos sessions apparaissent ici apres pointage.</p>
            </section>
          ) : null}

          <div className="space-y-5">
            {days.map((day) => (
              <section className="space-y-3" key={`${day.date}-${day.sessions[0]?.id ?? 'empty'}`}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
                    {formatDay(day.date)}
                  </h3>
                  <span className="text-xs font-bold text-slate-400">
                    {day.sessions.length} session(s)
                  </span>
                </div>

                {day.photos.length > 0 ? (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {day.photos.slice(0, 8).map((photo) => (
                      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-100" key={photo.id}>
                        <SignedImage photoId={photo.id} alt={photo.filename} className="object-cover" fill sizes="64px" />
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="space-y-3">
                  {day.sessions.map((session) => (
                    <SessionCard
                      key={session.id}
                      onOpen={() => setActiveSession(session)}
                      session={session}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {historyQuery.hasNextPage ? (
            <button
              className="min-h-14 w-full rounded-lg border border-slate-300 px-4 text-sm font-bold text-slate-700 disabled:opacity-50"
              disabled={historyQuery.isFetchingNextPage}
              onClick={() => {
                void historyQuery.fetchNextPage();
              }}
              type="button"
            >
              {historyQuery.isFetchingNextPage ? 'Chargement...' : 'Charger plus'}
            </button>
          ) : null}
        </>
      ) : (
        <>
          {reportsQuery.isLoading ? <LoadingState /> : null}

          {reportsQuery.isError ? (
            <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
              Impossible de charger l&apos;historique des rapports.
            </section>
          ) : null}

          {!reportsQuery.isLoading && reports.length === 0 ? (
            <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <h3 className="text-lg font-black text-slate-950">Aucun rapport</h3>
              <p className="mt-2 text-sm text-slate-500">Vos rapports apparaissent ici apres soumission.</p>
            </section>
          ) : null}

          <div className="space-y-3">
            {reports.map((report) => (
              <ReportCard
                key={report.id}
                report={report}
                onOpen={() => {
                  // Récupérer les détails du rapport
                  authFetch(`/api/mobile/history/reports/${report.id}`)
                    .then((res) => res.json())
                    .then((detail: ReportDetail) => setActiveReport(detail))
                    .catch(console.error);
                }}
              />
            ))}
          </div>

          {reportsQuery.hasNextPage ? (
            <button
              className="min-h-14 w-full rounded-lg border border-slate-300 px-4 text-sm font-bold text-slate-700 disabled:opacity-50"
              disabled={reportsQuery.isFetchingNextPage}
              onClick={() => {
                void reportsQuery.fetchNextPage();
              }}
              type="button"
            >
              {reportsQuery.isFetchingNextPage ? 'Chargement...' : 'Charger plus'}
            </button>
          ) : null}
        </>
      )}

      {activeSession ? (
        <SessionDetail session={activeSession} onClose={() => setActiveSession(null)} />
      ) : null}

      {activeReport ? (
        <ReportDetailModal report={activeReport} onClose={() => setActiveReport(null)} />
      ) : null}
    </div>
  );
}

function PeriodButton({
  active,
  label,
  onClick,
}: Readonly<{ active: boolean; label: string; onClick: () => void }>) {
  return (
    <button
      className={`min-h-12 rounded-lg text-sm font-black ${
        active ? 'bg-white text-primary shadow-sm' : 'text-slate-500'
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function SummaryTile({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 text-center shadow-panel">
      <div className="truncate text-lg font-black text-slate-950">{value}</div>
      <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </div>
    </article>
  );
}

function SessionCard({
  onOpen,
  session,
}: Readonly<{ onOpen: () => void; session: MobileHistorySession }>) {
  return (
    <button
      className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left shadow-panel transition active:scale-[0.99]"
      onClick={onOpen}
      type="button"
    >
      <div className="flex items-start gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${statusTone(session.status)}`}>
          <StatusIcon status={session.status} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h4 className="truncate text-base font-black text-slate-950">{session.siteName}</h4>
            <span className="shrink-0 text-sm font-bold text-slate-500">
              {formatTime(session.startedAt)}
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            {statusLabels[session.status]} - {formatDuration(session.realDurationSeconds)}
          </p>
          {session.photos.length > 0 ? (
            <p className="mt-2 text-xs font-bold text-primary">{session.photos.length} photo(s)</p>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function SessionDetail({
  onClose,
  session,
}: Readonly<{ onClose: () => void; session: MobileHistorySession }>) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white text-slate-950">
      <header className="border-b border-slate-200 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <button className="text-sm font-bold text-primary" onClick={onClose} type="button">
          Fermer
        </button>
        <h2 className="mt-3 text-2xl font-black">{session.siteName}</h2>
        <p className="mt-1 text-sm font-semibold text-slate-500">
          {statusLabels[session.status]} - {formatDay(session.startedAt.slice(0, 10))}
        </p>
      </header>

      <main className="custom-scrollbar flex-1 space-y-5 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <section className="grid grid-cols-2 gap-3">
          <SummaryTile label="Reel" value={formatDuration(session.realDurationSeconds)} />
          <SummaryTile label="Pauses" value={formatDuration(session.pauseDurationSeconds)} />
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">Timeline</h3>
          <div className="space-y-3">
            {session.records.map((record) => (
              <article className="rounded-lg border border-slate-200 bg-slate-50 p-4" key={record.id}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-black text-slate-950">{formatRecordType(record.type)}</p>
                  <span className="text-sm font-bold text-slate-500">{formatTime(record.timestampLocal)}</span>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  Distance : {record.distanceToSite.toFixed(2)} km - Statut : {record.status}
                </p>
                {record.comment ? (
                  <p className="mt-2 rounded-lg bg-white p-3 text-sm text-slate-700">{record.comment}</p>
                ) : null}
              </article>
            ))}
          </div>
        </section>

        {session.report ? (
          <section className="rounded-lg border border-primary/20 bg-primary/10 p-4">
            <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Rapport soumis</h3>
            <p className="mt-3 text-sm leading-6 text-slate-700">{session.report.content}</p>
          </section>
        ) : null}

        <section className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
            Photos de session
          </h3>
          {session.photos.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {session.photos.map((photo) => (
                <div className="relative aspect-square overflow-hidden rounded-lg bg-slate-100" key={photo.id}>
                  <SignedImage photoId={photo.id} alt={photo.filename} className="object-cover" fill sizes="33vw" />
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500">
              Aucune photo durant cette session.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3">
      <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
      <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
    </div>
  );
}

function StatusIcon({ status }: Readonly<{ status: MobileHistorySessionStatus }>) {
  if (status === 'COMPLETE') {
    return '✓';
  }

  if (status === 'PAUSE_ACTIVE') {
    return 'Ⅱ';
  }

  if (status === 'IN_PROGRESS') {
    return '…';
  }

  return '!';
}

function statusTone(status: MobileHistorySessionStatus) {
  if (status === 'COMPLETE') {
    return 'bg-emerald-100 text-emerald-700';
  }

  if (status === 'PAUSE_ACTIVE') {
    return 'bg-orange-100 text-orange-700';
  }

  if (status === 'IN_PROGRESS') {
    return 'bg-sky-100 text-sky-700';
  }

  return 'bg-red-100 text-red-700';
}

function formatRecordType(type: string) {
  const labels: Record<string, string> = {
    ARRIVAL: 'Arrivee',
    PAUSE_START: 'Debut pause',
    PAUSE_END: 'Fin pause',
    DEPARTURE: 'Depart',
    INTERMEDIATE: 'Intermediaire',
  };

  return labels[type] ?? type;
}

function formatDay(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatHours(seconds: number) {
  const hours = seconds / 3600;
  return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`;
}

function formatDuration(seconds: number) {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}h ${remainingMinutes}min`;
  }

  return `${remainingMinutes}min`;
}

function TabButton({
  active,
  label,
  onClick,
}: Readonly<{ active: boolean; label: string; onClick: () => void }>) {
  return (
    <button
      className={`min-h-12 rounded-lg text-sm font-black transition active:scale-[0.98] ${
        active ? 'bg-white text-primary shadow-sm' : 'text-slate-500'
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function ReportCard({
  report,
  onOpen,
}: Readonly<{ report: ReportSummary; onOpen: () => void }>) {
  const statusConfig = {
    SUBMITTED: { color: 'bg-blue-100 text-blue-700', label: 'Soumis' },
    REVIEWED: { color: 'bg-orange-100 text-orange-700', label: 'Révisé' },
    VALIDATED: { color: 'bg-emerald-100 text-emerald-700', label: 'Validé' },
    SENT: { color: 'bg-purple-100 text-purple-700', label: 'Envoyé client' },
  };

  const status = statusConfig[report.status];

  return (
    <button
      className="w-full rounded-lg border border-slate-200 bg-white p-4 text-left shadow-panel transition active:scale-[0.99]"
      onClick={onOpen}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3 mb-1">
            <h4 className="truncate text-base font-black text-slate-950">{report.siteName}</h4>
            <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${status.color}`}>
              {status.label}
            </span>
          </div>
          <p className="text-sm text-slate-600 mb-2">
            {formatDay(report.date)} - {formatTime(report.createdAt)}
          </p>
          <p className="text-sm text-slate-700 line-clamp-2">
            {report.content}
          </p>
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-500">Progression:</span>
              <span className="text-xs font-bold text-slate-700">{report.progressPercentage}%</span>
            </div>
            {report.photoCount > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-500">Photos:</span>
                <span className="text-xs font-bold text-slate-700">{report.photoCount}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function ReportDetailModal({
  report,
  onClose,
}: Readonly<{ report: ReportDetail; onClose: () => void }>) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white text-slate-950">
      <header className="border-b border-slate-200 px-4 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
        <button className="text-sm font-bold text-primary" onClick={onClose} type="button">
          Fermer
        </button>
        <h2 className="mt-3 text-2xl font-black">{report.siteName}</h2>
        <p className="mt-1 text-sm font-semibold text-slate-500">
          {formatDay(report.date)} - {formatTime(report.createdAt)}
        </p>
      </header>

      <main className="custom-scrollbar flex-1 space-y-5 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <section className="grid grid-cols-2 gap-3">
          <SummaryTile label="Progression" value={`${report.progressPercentage}%`} />
          <SummaryTile label="Photos" value={String(report.photoCount)} />
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">Contenu du rapport</h3>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm leading-6 text-slate-700 whitespace-pre-wrap">
              {report.content}
            </p>
          </div>
        </section>

        {report.blockageNote && (
          <section className="space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">Blocage / Remarque</h3>
            <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
              <p className="text-sm leading-6 text-orange-800">
                {report.blockageNote}
              </p>
            </div>
          </section>
        )}

        {report.coordinatorComment && (
          <section className="space-y-3">
            <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">Commentaire du coordinateur</h3>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm leading-6 text-blue-800">
                {report.coordinatorComment}
              </p>
            </div>
          </section>
        )}

        <section className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">Informations de session</h3>
          <div className="grid grid-cols-2 gap-3">
            <SummaryTile label="Arrivée" value={formatTime(report.sessionInfo.arrivalAt)} />
            <SummaryTile label="Départ" value={formatTime(report.sessionInfo.departureAt)} />
            <SummaryTile label="Durée" value={formatDuration(report.sessionInfo.durationSeconds)} />
            <SummaryTile label="Statut" value={report.status} />
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
            Photos du rapport ({report.photos.length})
          </h3>
          {report.photos.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {report.photos.map((photo) => (
                <div className="relative aspect-square overflow-hidden rounded-lg bg-slate-100" key={photo.id}>
                  <SignedImage photoId={photo.id} alt={photo.filename} className="object-cover" fill sizes="33vw" />
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500">
              Aucune photo pour ce rapport.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
