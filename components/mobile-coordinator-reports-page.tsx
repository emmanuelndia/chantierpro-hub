'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, FileText, Search } from 'lucide-react';
import { authFetch } from '@/lib/auth/client-session';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type {
  CoordinatorReportsResponse,
  MobileReportCoveragePeriod,
  MobileReportSiteCoverageItem,
  ReceivedReport,
} from '@/types/mobile-reports';
import {
  MobileReportsEmptyState,
  MobileReportsErrorState,
  MobileReportsLoadingState,
} from './mobile-reports-error-state';

type MobileCoordinatorReportsPageProps = Readonly<{
  user: WebSessionUser;
}>;

export function MobileCoordinatorReportsPage({ user }: MobileCoordinatorReportsPageProps) {
  const [data, setData] = useState<CoordinatorReportsResponse | null>(null);
  const [coveragePeriod, setCoveragePeriod] = useState<MobileReportCoveragePeriod>('today');
  const [expandedSiteId, setExpandedSiteId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReports = async () => {
      try {
        setLoading(true);
        const response = await authFetch(`/api/mobile/coordinator/reports?coveragePeriod=${coveragePeriod}`);

        if (!response.ok) {
          throw new Error(`Erreur ${response.status}`);
        }

        setData((await response.json()) as CoordinatorReportsResponse);
        setExpandedSiteId(null);
        setError(null);
      } catch {
        setError('Connectez-vous pour charger les rapports.');
      } finally {
        setLoading(false);
      }
    };

    void fetchReports();
  }, [coveragePeriod, user.role]);

  const visibleCoverage = useMemo(() => {
    const items = data?.siteCoverage ?? [];
    const search = query.trim().toLowerCase();

    if (!search) {
      return items;
    }

    return items.filter((item) =>
      [item.projectName, item.siteName, item.projectManagerName].some((value) =>
        value.toLowerCase().includes(search),
      ),
    );
  }, [data?.siteCoverage, query]);

  const reportsBySite = useMemo(() => {
    const map = new Map<string, ReceivedReport[]>();
    for (const report of data?.receivedReports ?? []) {
      if (!report.siteId) continue;
      const current = map.get(report.siteId) ?? [];
      current.push(report);
      map.set(report.siteId, current);
    }
    return map;
  }, [data?.receivedReports]);

  if (loading) return <MobileReportsLoadingState count={5} />;

  if (error) {
    return (
      <MobileReportsErrorState
        detail={error}
        message="Connectez-vous pour charger les rapports"
        onRetry={() => window.location.reload()}
      />
    );
  }

  if (!data || data.siteCoverage.length === 0) {
    return (
      <MobileReportsEmptyState
        message="Aucun chantier suivi"
        description="Aucun chef projet ne t'a encore rattache a son portefeuille."
      />
    );
  }

  const missingCount = data.siteCoverage.filter((item) => item.status === 'MISSING').length;

  return (
    <div className="space-y-5 pb-6">
      <header className="rounded-[1.75rem] bg-slate-950 p-5 text-white shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-300">Coordinateur</p>
        <h1 className="mt-2 text-2xl font-black">Suivi des rapports</h1>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Controle rapidement les chantiers suivis et ouvre les rapports recus.
        </p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <SummaryTile label="Chantiers" value={String(data.siteCoverage.length)} />
          <SummaryTile label="Recus" value={String(data.summary.receivedCount)} />
          <SummaryTile label="Sans rapport" value={String(missingCount)} warning={missingCount > 0} />
        </div>
      </header>

      <section className="space-y-3 rounded-[1.5rem] border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
          {(['today', 'week'] as const).map((period) => (
            <button
              className={`rounded-xl px-3 py-2 text-sm font-black transition ${
                coveragePeriod === period ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'
              }`}
              key={period}
              onClick={() => setCoveragePeriod(period)}
              type="button"
            >
              {period === 'today' ? "Aujourd'hui" : 'Cette semaine'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-2">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher projet ou chantier"
            value={query}
          />
        </label>
      </section>

      <section className="space-y-3">
        {visibleCoverage.length === 0 ? (
          <MobileReportsEmptyState message="Aucun chantier trouve" />
        ) : (
          visibleCoverage.map((item) => (
            <SiteCoverageCard
              expanded={expandedSiteId === item.siteId}
              item={item}
              key={item.siteId}
              onToggle={() => setExpandedSiteId((current) => (current === item.siteId ? null : item.siteId))}
              period={coveragePeriod}
              reports={reportsBySite.get(item.siteId) ?? []}
            />
          ))
        )}
      </section>
    </div>
  );
}

function SummaryTile({ label, value, warning = false }: Readonly<{ label: string; value: string; warning?: boolean }>) {
  return (
    <div className={`rounded-2xl p-3 ${warning ? 'bg-orange-500/20' : 'bg-white/10'}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-300">{label}</p>
      <p className="mt-1 text-xl font-black text-white">{value}</p>
    </div>
  );
}

function SiteCoverageCard({
  expanded,
  item,
  onToggle,
  period,
  reports,
}: Readonly<{
  expanded: boolean;
  item: MobileReportSiteCoverageItem;
  onToggle: () => void;
  period: MobileReportCoveragePeriod;
  reports: ReceivedReport[];
}>) {
  const hasReports = item.status === 'RECEIVED';

  return (
    <article className="overflow-hidden rounded-[1.5rem] border border-slate-200 bg-white shadow-sm">
      <button className="w-full p-4 text-left transition active:scale-[0.99]" onClick={onToggle} type="button">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
              {item.projectName}
            </p>
            <h2 className="mt-1 text-base font-black text-slate-950">{item.siteName}</h2>
            <p className="mt-1 text-xs font-semibold text-slate-500">Chef projet : {item.projectManagerName}</p>
          </div>
          <ChevronDown className={`mt-1 h-5 w-5 text-slate-400 transition ${expanded ? 'rotate-180' : ''}`} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-black ${
              hasReports ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'
            }`}
          >
            {hasReports ? `${item.reportsCount} rapport(s) recu(s)` : 'Aucun rapport'}
          </span>
          {item.latestReportAt ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
              Dernier : {formatDateTime(item.latestReportAt)}
            </span>
          ) : null}
        </div>
      </button>

      {expanded ? (
        <div className="border-t border-slate-100 bg-slate-50 p-4">
          {reports.length > 0 ? (
            <div className="space-y-2">
              {reports.map((report) => (
                <Link
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 transition active:scale-[0.98]"
                  href={`/mobile/reports/${report.id}`}
                  key={report.id}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900">
                      {report.supervisorFirstName} {report.supervisorName}
                    </p>
                    <p className="text-xs font-semibold text-slate-500">
                      Envoye le {formatDateTime(report.submittedAt)}
                    </p>
                  </div>
                  <FileText className="h-5 w-5 shrink-0 text-orange-500" />
                </Link>
              ))}
            </div>
          ) : (
            <p className="rounded-2xl bg-white p-3 text-sm font-semibold text-slate-500">
              {period === 'today'
                ? "Aucun rapport envoye aujourd'hui pour ce chantier."
                : 'Aucun rapport envoye cette semaine pour ce chantier.'}
            </p>
          )}
        </div>
      ) : null}
    </article>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
