'use client';

import Link from 'next/link';

type ReportItem = {
  id: string;
  site: { id: string; name: string };
  user?: { id: string; firstName: string; lastName: string; role: string };
  clockInRecord: { clockInDate: string; clockInTime: string };
  content: string;
  progression: number | null;
  blocage: string | null;
  status: string;
  submittedAt: string;
};

type MobileReportsListProps = Readonly<{
  reports: ReportItem[];
}>;

export function MobileReportsList({ reports }: MobileReportsListProps) {
  return (
    <div className="space-y-4">
      {reports.map((report) => (
        <Link
          key={report.id}
          href={`/mobile/reports/${report.id}`}
          className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition active:scale-[0.98]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-2">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                  {report.site.name}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getStatusColor(report.status)}`}>
                  {report.status}
                </span>
              </div>
              
              {report.user && (
                <p className="text-xs font-bold text-slate-500 mb-1">
                  Par: {report.user.firstName} {report.user.lastName}
                </p>
              )}
              
              <p className="line-clamp-2 text-sm text-slate-700 mb-2">
                {report.content}
              </p>
              
              <div className="flex items-center gap-3 text-[11px] text-slate-500">
                <span className="flex items-center gap-1">
                  <CalendarIcon className="h-3 w-3" />
                  {new Date(report.clockInRecord.clockInDate).toLocaleDateString('fr-FR')}
                </span>
                {report.progression !== null && (
                  <span className="flex items-center gap-1 font-semibold text-primary">
                    <TrendingUpIcon className="h-3 w-3" />
                    {report.progression}%
                  </span>
                )}
              </div>
            </div>
            
            <div className="shrink-0 flex flex-col items-end gap-1">
              <span className="text-[10px] font-medium text-slate-400">
                {new Date(report.submittedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </span>
              {report.blocage && (
                <div className="rounded-full bg-red-100 p-1">
                  <AlertTriangleIcon className="h-3 w-3 text-red-600" />
                </div>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function getStatusColor(status: string) {
  switch (status) {
    case 'RECU': return 'bg-blue-100 text-blue-700';
    case 'EN_REVUE': return 'bg-orange-100 text-orange-700';
    case 'VALIDE': return 'bg-emerald-100 text-emerald-700';
    case 'ENVOYE': return 'bg-purple-100 text-purple-700';
    default: return 'bg-slate-100 text-slate-700';
  }
}

function CalendarIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function TrendingUpIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  );
}

function AlertTriangleIcon({ className }: { className: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}
