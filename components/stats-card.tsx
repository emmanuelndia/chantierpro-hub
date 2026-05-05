import type { ReactNode } from 'react';
import type { DashboardStat } from '@/types/dashboard';

type StatsCardProps = Readonly<{
  stat: DashboardStat;
}>;

const toneClasses: Record<NonNullable<DashboardStat['tone']>, string> = {
  primary: 'bg-slate-950 text-white',
  success: 'bg-emerald-50 text-emerald-900',
  warning: 'bg-orange-50 text-orange-900',
  danger: 'bg-red-50 text-red-900',
  neutral: 'bg-white text-slate-900',
};

const deltaClasses: Record<NonNullable<DashboardStat['tone']>, string> = {
  primary: 'bg-white/10 text-slate-100',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-orange-100 text-orange-700',
  danger: 'bg-red-100 text-red-700',
  neutral: 'bg-slate-100 text-slate-600',
};

export function StatsCard({ stat }: StatsCardProps) {
  const tone = stat.tone ?? 'neutral';

  return (
    <article
      className={`rounded-3xl border border-slate-200 p-5 shadow-panel ${toneClasses[tone]}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p
            className={`text-xs font-semibold uppercase tracking-[0.18em] ${
              tone === 'primary' ? 'text-slate-200' : 'text-slate-500'
            }`}
          >
            {stat.label}
          </p>
          <p className="mt-3 text-3xl font-semibold tracking-tight">{stat.value}</p>
        </div>
        <div
          className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
            tone === 'primary' ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-700'
          }`}
        >
          <StatsIcon icon={stat.icon} />
        </div>
      </div>

      {typeof stat.delta === 'number' || stat.deltaLabel ? (
        <div className="mt-4">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${deltaClasses[tone]}`}
          >
            {typeof stat.delta === 'number' ? formatDelta(stat.delta) : stat.deltaLabel}
            {typeof stat.delta === 'number' && stat.deltaLabel ? ` ${stat.deltaLabel}` : ''}
          </span>
        </div>
      ) : null}
    </article>
  );
}

function formatDelta(value: number) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function StatsIcon({ icon }: Readonly<{ icon: DashboardStat['icon'] }>) {
  let content: ReactNode;

  switch (icon) {
    case 'projects':
      content = <path d="M4 6h16v12H4zM9 6v12M4 11h16" />;
      break;
    case 'users':
      content = (
        <>
          <circle cx="9" cy="9" r="2.5" />
          <path d="M4.5 18a4.5 4.5 0 0 1 9 0M16 7.5a2 2 0 1 0 0-4M18.5 18a4 4 0 0 0-2.5-3.6" />
        </>
      );
      break;
    case 'sites':
      content = (
        <>
          <path d="M12 20s6-5.33 6-10a6 6 0 1 0-12 0c0 4.67 6 10 6 10Z" />
          <circle cx="12" cy="10" r="2.3" />
        </>
      );
      break;
    case 'photos':
      content = (
        <>
          <path d="M4 8h4l1.6-2h4.8L16 8h4v10H4z" />
          <circle cx="12" cy="13" r="3" />
        </>
      );
      break;
    case 'reports':
      content = (
        <>
          <path d="M7 4h7l4 4v12H7z" />
          <path d="M14 4v4h4M10 12h5M10 16h5" />
        </>
      );
      break;
    case 'clock':
      content = (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l3 2" />
        </>
      );
      break;
    case 'exports':
      content = <path d="M12 4v10M8.5 10.5 12 14l3.5-3.5M5 18h14" />;
      break;
    case 'alerts':
      content = (
        <>
          <path d="M12 4 4 19h16L12 4Z" />
          <path d="M12 9v4M12 16h.01" />
        </>
      );
      break;
    case 'planning':
      content = (
        <>
          <path d="M6 5v3M18 5v3M5 9h14M5 7h14v12H5z" />
          <path d="M9 13h2M13 13h2M9 16h2" />
        </>
      );
      break;
    case 'shield':
      content = (
        <>
          <path d="M12 4 6 6v5c0 4.5 2.9 7.7 6 9 3.1-1.3 6-4.5 6-9V6z" />
          <path d="m9.5 12 1.8 1.8 3.2-3.6" />
        </>
      );
      break;
    default:
      content = <path d="M4 12h16" />;
      break;
  }

  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        {content}
      </g>
    </svg>
  );
}
