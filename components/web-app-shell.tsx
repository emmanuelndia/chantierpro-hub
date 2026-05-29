'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState, type ReactNode } from 'react';
import type { Role } from '@prisma/client';
import { Badge } from '@/components/badge';
import { MustChangePasswordBanner } from '@/components/must-change-password-banner';
import { useToast } from '@/components/toast-provider';
import { getWebBreadcrumbs, getWebNavigationForRole } from '@/lib/navigation';
import { formatRoleLabel } from '@/lib/role-labels';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type { WebNavIcon } from '@/types/navigation';

type WebAppShellProps = Readonly<{
  user: WebSessionUser;
  children: ReactNode;
}>;

type WebNotification = Readonly<{
  href: string;
  message: string;
  title: string;
  tone: 'warning' | 'info';
}>;

const roleTone: Record<Role, 'success' | 'warning' | 'error' | 'neutral' | 'info'> = {
  SUPERVISOR: 'success',
  RESOURCE: 'success',
  COORDINATOR: 'info',
  GENERAL_SUPERVISOR: 'warning',
  BE_MANAGER: 'warning',
  BE_RESOURCE: 'success',
  NEGOTIATION_MANAGER: 'warning',
  NEGOTIATION_RESOURCE: 'success',
  FLEET_MANAGER: 'warning',
  DRIVER: 'success',
  PROJECT_MANAGER: 'neutral',
  DIRECTION: 'error',
  HR: 'info',
  ADMIN: 'neutral',
};

export function WebAppShell({ user, children }: WebAppShellProps) {
  const pathname = usePathname();
  const navigation = useMemo(() => getWebNavigationForRole(user.role), [user.role]);
  const breadcrumbs = useMemo(() => getWebBreadcrumbs(pathname), [pathname]);
  const notifications = useMemo<WebNotification[]>(() => {
    const items: WebNotification[] = [];

    if (user.mustChangePassword) {
      items.push({
        href: '/settings/profil',
        message: 'Votre mot de passe temporaire doit être changé.',
        title: 'Mot de passe temporaire',
        tone: 'warning',
      });
    }

    return items;
  }, [user.mustChangePassword]);
  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { pushToast } = useToast();

  async function handleLogout() {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });

      if (!response.ok && response.status !== 204) {
        pushToast({
          type: 'error',
          title: 'Deconnexion impossible',
          message: 'Le serveur a refuse la fermeture de session.',
        });
        return;
      }

      window.location.href = '/login';
    } catch {
      pushToast({
        type: 'error',
        title: 'Deconnexion impossible',
        message: 'Verifie ta connexion puis reessaie.',
      });
    }
  }

  return (
    <div className="h-screen overflow-hidden bg-slate-100">
      {sidebarOpen ? (
        <button
          aria-label="Fermer la navigation"
          className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          type="button"
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-slate-800 bg-slate-950 text-white transition-transform duration-300 lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-800 px-5">
          <Link className="text-lg font-bold tracking-[0.2em]" href="/web/dashboard">
            CHANTIER<span className="text-orange-500">PRO</span>
          </Link>
          <button
            aria-label="Fermer la navigation"
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-900 hover:text-white lg:hidden"
            onClick={() => setSidebarOpen(false)}
            type="button"
          >
            <CrossIcon className="h-5 w-5" />
          </button>
        </div>

        <nav className="custom-scrollbar flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navigation.map((item) => {
            const active = pathname === item.href;

            return (
              <Link
                key={item.href}
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition ${
                  active
                    ? 'bg-orange-600 text-white shadow-lg shadow-orange-950/25'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
              >
                <NavigationIcon icon={item.icon} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex h-full min-w-0 flex-col lg:pl-60">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              aria-label="Ouvrir la navigation"
              className="rounded-full p-2 text-slate-600 transition hover:bg-slate-100 hover:text-primary lg:hidden"
              onClick={() => setSidebarOpen(true)}
              type="button"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/70">
                ChantierPro
              </p>
              <nav className="mt-1 flex min-w-0 items-center gap-2 text-sm text-slate-500">
                {breadcrumbs.map((item, index) => (
                  <div key={`${item}-${index}`} className="flex min-w-0 items-center gap-2">
                    {index > 0 ? <span className="text-slate-300">/</span> : null}
                    <span
                      className={`truncate ${
                        index === breadcrumbs.length - 1 ? 'font-semibold text-ink' : ''
                      }`}
                    >
                      {item}
                    </span>
                  </div>
                ))}
              </nav>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Badge tone={roleTone[user.role]}>{formatRoleLabel(user.role)}</Badge>
            <div className="relative">
              <button
                aria-expanded={notificationsOpen}
                aria-label={notifications.length > 0 ? `${notifications.length} notification(s)` : 'Notifications'}
                className="relative rounded-full border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50 hover:text-primary"
                onClick={() => {
                  setNotificationsOpen((current) => !current);
                  setMenuOpen(false);
                }}
                type="button"
              >
                <BellIcon className="h-5 w-5" />
                {notifications.length > 0 ? (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {notifications.length > 9 ? '9+' : notifications.length}
                  </span>
                ) : null}
              </button>

              {notificationsOpen ? (
                <WebNotificationsPanel
                  notifications={notifications}
                  onClose={() => setNotificationsOpen(false)}
                />
              ) : null}
            </div>
            <div className="relative">
              <button
                className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-2 py-1.5 transition hover:bg-slate-50"
                onClick={() => {
                  setMenuOpen((current) => !current);
                  setNotificationsOpen(false);
                }}
                type="button"
              >
                <div className="hidden text-right sm:block">
                  <p className="text-sm font-semibold text-ink">
                    {user.firstName} {user.lastName}
                  </p>
                  <p className="text-xs text-slate-500">Session active</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-950 text-sm font-semibold text-white">
                  {initials}
                </div>
              </button>

              {menuOpen ? (
                <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-60 rounded-3xl border border-slate-200 bg-white p-2 shadow-panel">
                  <Link
                    className="flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    href="/settings/profil"
                    onClick={() => setMenuOpen(false)}
                  >
                    <NavigationIcon icon="profile" />
                    Mon profil
                  </Link>
                  <button
                    className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium text-red-700 transition hover:bg-red-50"
                    onClick={() => {
                      void handleLogout();
                    }}
                    type="button"
                  >
                    <LogoutIcon className="h-5 w-5" />
                    Deconnexion
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="custom-scrollbar h-[calc(100vh-4rem)] overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
<MustChangePasswordBanner href="/settings/profil" show={user.mustChangePassword} />
          {children}
        </main>
      </div>
    </div>
  );
}

function WebNotificationsPanel({
  notifications,
  onClose,
}: Readonly<{
  notifications: readonly WebNotification[];
  onClose: () => void;
}>) {
  return (
    <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-80 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-panel">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-orange-600">Notifications</p>
          <h2 className="mt-1 text-base font-black text-slate-950">Centre de notifications</h2>
        </div>
        <button
          aria-label="Fermer les notifications"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
          onClick={onClose}
          type="button"
        >
          <CrossIcon className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-[22rem] overflow-y-auto p-3">
        {notifications.length > 0 ? (
          <div className="space-y-2">
            {notifications.map((notification) => (
              <Link
                className="block rounded-2xl border border-slate-200 bg-slate-50 p-3 transition hover:border-orange-200 hover:bg-orange-50"
                href={notification.href}
                key={`${notification.href}-${notification.title}`}
                onClick={onClose}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                      notification.tone === 'warning' ? 'bg-orange-500' : 'bg-sky-500'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-950">{notification.title}</p>
                    <p className="mt-1 text-sm leading-5 text-slate-600">{notification.message}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
            <p className="text-sm font-black text-slate-800">Aucune notification</p>
            <p className="mt-1 text-sm leading-5 text-slate-500">Les alertes importantes apparaîtront ici.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function NavigationIcon({
  icon,
  className = 'h-5 w-5',
}: Readonly<{ icon: WebNavIcon; className?: string }>) {
  switch (icon) {
    case 'dashboard':
      return <DashboardIcon className={className} />;
    case 'my-projects':
      return <HelmetIcon className={className} />;
    case 'projects':
      return <GridIcon className={className} />;
    case 'rh':
      return <ClockIcon className={className} />;
    case 'consolidated':
      return <ChartIcon className={className} />;
    case 'photos':
      return <CameraIcon className={className} />;
    case 'reports':
      return <ReportIcon className={className} />;
    case 'planning':
      return <CalendarIcon className={className} />;
    case 'logs':
      return <HistoryIcon className={className} />;
    case 'users':
      return <UsersIcon className={className} />;
    case 'profile':
      return <ProfileIcon className={className} />;
    case 'password':
      return <KeyIcon className={className} />;
    default:
      return <GridIcon className={className} />;
  }
}

function baseIconPath(className: string, children: ReactNode) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

function DashboardIcon({ className }: Readonly<{ className: string }>) {
  return baseIconPath(
    className,
    <>
      <rect x="3" y="3" width="7" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    </>,
  );
}

function HelmetIcon({ className }: Readonly<{ className: string }>) {
  return baseIconPath(
    className,
    <>
      <path d="M4 14a8 8 0 0 1 16 0v4H4v-4Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 6v4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function GridIcon({ className }: Readonly<{ className: string }>) {
  return baseIconPath(
    className,
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
    </>,
  );
}

function ClockIcon({ className }: Readonly<{ className: string }>) {
  return baseIconPath(
    className,
    <>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function ChartIcon({ className }: Readonly<{ className: string }>) {
  return baseIconPath(
    className,
    <>
      <path d="M4 19h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M7 16v-4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M12 16V8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M17 16v-6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function CameraIcon({ className }: Readonly<{ className: string }>) {
  return baseIconPath(
    className,
    <>
      <path d="M4 8h4l2-2h4l2 2h4v10H4V8Z" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="1.8" />
    </>,
  );
}

function ReportIcon({ className }: Readonly<{ className: string }>) {
  return baseIconPath(
    className,
    <>
      <path d="M7 4h7l4 4v12H7V4Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M14 4v4h4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10 12h5M10 16h5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function CalendarIcon({ className }: Readonly<{ className: string }>) {
  return baseIconPath(
    className,
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M8 14h3M13 14h3M8 17h3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function HistoryIcon({ className }: Readonly<{ className: string }>) {
  return baseIconPath(
    className,
    <>
      <path d="M4 12a8 8 0 1 0 3-6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 4v5h5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M12 8v4l2 2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function UsersIcon({ className }: Readonly<{ className: string }>) {
  return baseIconPath(
    className,
    <>
      <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 19a6 6 0 0 1 12 0" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 11a3 3 0 1 0 0-6" stroke="currentColor" strokeWidth="1.8" />
      <path d="M18 19a5 5 0 0 0-3-4.58" stroke="currentColor" strokeWidth="1.8" />
    </>,
  );
}

function ProfileIcon({ className }: Readonly<{ className: string }>) {
  return baseIconPath(
    className,
    <>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 20a7 7 0 0 1 14 0" stroke="currentColor" strokeWidth="1.8" />
    </>,
  );
}

function KeyIcon({ className }: Readonly<{ className: string }>) {
  return baseIconPath(
    className,
    <>
      <circle cx="8" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M11 12h9M17 12v3M20 12v2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function BellIcon({ className }: Readonly<{ className: string }>) {
  return baseIconPath(
    className,
    <>
      <path
        d="M7 10a5 5 0 0 1 10 0c0 5 2 6 2 6H5s2-1 2-6Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.8" />
    </>,
  );
}

function MenuIcon({ className }: Readonly<{ className: string }>) {
  return baseIconPath(
    className,
    <>
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function CrossIcon({ className }: Readonly<{ className: string }>) {
  return baseIconPath(
    className,
    <>
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function LogoutIcon({ className }: Readonly<{ className: string }>) {
  return baseIconPath(
    className,
    <>
      <path d="M9 5H5v14h4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M13 8l4 4-4 4M17 12H9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}
