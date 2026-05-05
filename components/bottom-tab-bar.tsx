'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import type { getMobileNavigationForRole } from '@/lib/navigation';
import type { MobileTabIcon } from '@/types/navigation';

type BottomTabBarProps = Readonly<{
  hasOpenSession: boolean;
  incompleteSessionCount: number;
  tabs: ReturnType<typeof getMobileNavigationForRole>;
}>;

export function BottomTabBar({
  hasOpenSession,
  incompleteSessionCount,
  tabs,
}: BottomTabBarProps) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md border-t border-slate-200 bg-white/95 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[0_-12px_30px_rgba(20,34,54,0.08)] backdrop-blur">
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const showOpenSessionDot = tab.href === '/mobile/clock-in' && hasOpenSession;
          const showHistoryBadge = tab.href === '/mobile/history' && incompleteSessionCount > 0;

          return (
            <Link
              key={tab.href}
              className={`relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-semibold transition ${
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-ink'
              }`}
              href={tab.href}
            >
              <span className="relative">
                <MobileTabIconView icon={tab.icon} />
                {showOpenSessionDot ? (
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-success" />
                ) : null}
                {showHistoryBadge ? (
                  <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white">
                    {incompleteSessionCount}
                  </span>
                ) : null}
              </span>
              <span className="max-w-full truncate">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function MobileTabIconView({ icon }: Readonly<{ icon: MobileTabIcon }>) {
  switch (icon) {
    case 'home':
      return <HomeIcon />;
    case 'clock-in':
      return <ClockInIcon />;
    case 'photo':
      return <PhotoIcon />;
    case 'calendar':
      return <CalendarIcon />;
    case 'history':
      return <HistoryIcon />;
    case 'reports':
      return <ReportsIcon />;
    case 'teams':
      return <TeamsIcon />;
    case 'profile':
      return <ProfileIcon />;
    case 'folder':
      return <FolderIcon />;
    default:
      return <HomeIcon />;
  }
}

function baseIcon(children: ReactNode) {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

function HomeIcon() {
  return baseIcon(
    <>
      <path
        d="m4 11 8-7 8 7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M6.5 10.5V20h11v-9.5"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </>,
  );
}

function ClockInIcon() {
  return baseIcon(
    <>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function PhotoIcon() {
  return baseIcon(
    <>
      <path
        d="M4 8h4l2-2h4l2 2h4v10H4V8Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="1.8" />
    </>,
  );
}

function CalendarIcon() {
  return baseIcon(
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function HistoryIcon() {
  return baseIcon(
    <>
      <path d="M4 12a8 8 0 1 0 3-6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M4 4v5h5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M12 8v4l2 2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function ReportsIcon() {
  return baseIcon(
    <>
      <path
        d="M7 4h7l4 4v12H7V4Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M14 4v4h4M10 12h5M10 16h5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </>,
  );
}

function TeamsIcon() {
  return baseIcon(
    <>
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M16 11a2.7 2.7 0 1 0-.8-5.3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M17 14.5a5 5 0 0 1 3.5 4.7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function ProfileIcon() {
  return baseIcon(
    <>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 20a7 7 0 0 1 14 0" stroke="currentColor" strokeWidth="1.8" />
    </>,
  );
}

function FolderIcon() {
  return baseIcon(
    <>
      <path
        d="M3 7a2 2 0 012-2h4.586a1 1 0 01.707.293l1.414 1.414a1 1 0 00.707.293H15a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </>,
  );
}
