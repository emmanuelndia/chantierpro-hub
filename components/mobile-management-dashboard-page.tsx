'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SignedImage } from '@/components/mobile/SignedImage';
import { authFetch } from '@/lib/auth/client-session';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type {
  MobileManagementAlertItem,
  MobileManagementDashboardResponse,
  MobileManagementDashboardWidget,
  MobileManagementPhotoItem,
  MobileManagementSiteItem,
} from '@/types/mobile-management';

type MobileManagementDashboardPageProps = Readonly<{
  user: WebSessionUser;
}>;

export function MobileManagementDashboardPage({ user }: MobileManagementDashboardPageProps) {
  const dashboardQuery = useQuery({
    queryKey: ['mobile-management-dashboard'],
    queryFn: async () => {
      const response = await authFetch('/api/mobile/management/dashboard');

      if (!response.ok) {
        throw new Error(`Management dashboard request failed with status ${response.status}`);
      }

      return (await response.json()) as MobileManagementDashboardResponse;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const dashboard = dashboardQuery.data;

  return (
    <div className="space-y-5 pb-20">
      <section className="rounded-lg border border-primary/20 bg-primary/10 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
            <DashboardIcon className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-slate-950">Supervision mobile</p>
            <p className="mt-1 truncate text-sm text-slate-600">
              Bonjour {user.firstName}, suivi des chantiers actifs
            </p>
          </div>
        </div>
      </section>

      {dashboardQuery.isLoading ? <DashboardLoadingState /> : null}

      {dashboardQuery.isError ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          Impossible de charger le dashboard supervision. Verifiez la connexion puis reessayez.
        </section>
      ) : null}

      {dashboard ? (
        <>
          <section className="grid grid-cols-2 gap-3">
            {dashboard.widgets.map((widget) => (
              <WidgetTile key={widget.id} widget={widget} />
            ))}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
              Actions rapides
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <QuickActionCard href="/mobile/projects" icon={<ProjectsIcon />} label="Projets" />
              <QuickActionCard href="/mobile/sites" icon={<SitesIcon />} label="Chantiers" />
              <QuickActionCard href="/mobile/teams" icon={<TeamsIcon />} label="Équipes" />
              <QuickActionCard href="/mobile/presences" icon={<PresenceIcon />} label="Présences" />
              <QuickActionCard href="/mobile/reports" icon={<ReportsIcon />} label="Rapports" />
              <QuickActionCard href="/mobile/gallery" icon={<GalleryIcon />} label="Galerie" />
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
                Sites actifs
              </h2>
              <span className="text-xs font-semibold text-slate-400">
                {dashboard.sites.length} sites
              </span>
            </div>

            {dashboard.sites.length > 0 ? (
              <div className="space-y-3">
                {dashboard.sites.map((site) => (
                  <SiteCard key={site.id} site={site} />
                ))}
              </div>
            ) : (
              <EmptyPanel text="Aucun chantier actif dans votre perimetre." />
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
                Alertes
              </h2>
              <span className="text-xs font-semibold text-slate-400">
                {dashboard.alerts.length}
              </span>
            </div>

            {dashboard.alerts.length > 0 ? (
              <div className="space-y-2">
                {dashboard.alerts.map((alert) => (
                  <AlertRow alert={alert} key={alert.id} />
                ))}
              </div>
            ) : (
              <EmptyPanel text="Aucune alerte active." />
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
                Dernieres photos
              </h2>
              <span className="text-xs font-semibold text-slate-400">
                {dashboard.latestPhotos.length}/4
              </span>
            </div>

            {dashboard.latestPhotos.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {dashboard.latestPhotos.map((photo) => (
                  <PhotoThumb key={photo.id} photo={photo} />
                ))}
              </div>
            ) : (
              <EmptyPanel text="Aucune photo recente." />
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function WidgetTile({ widget }: Readonly<{ widget: MobileManagementDashboardWidget }>) {
  const tone = {
    present: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    resources: 'border-sky-200 bg-sky-50 text-sky-800',
    sites: 'border-primary/20 bg-primary/10 text-primary',
    alerts: 'border-red-200 bg-red-50 text-red-700',
  }[widget.id];

  return (
    <article className={`rounded-lg border p-4 ${tone}`}>
      <div className="text-3xl font-black">{widget.value}</div>
      <div className="mt-2 text-sm font-bold text-slate-950">{widget.label}</div>
      <div className="mt-1 text-xs font-semibold text-slate-500">{widget.helper}</div>
    </article>
  );
}

function QuickActionCard({
  href,
  icon,
  label,
}: Readonly<{
  href: string;
  icon: ReactNode;
  label: string;
}>) {
  return (
    <Link
      className="flex min-h-20 items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 text-slate-900 shadow-panel transition active:scale-[0.98]"
      href={href}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </span>
      <span className="min-w-0 text-sm font-black">{label}</span>
    </Link>
  );
}

function SiteCard({ site }: Readonly<{ site: MobileManagementSiteItem }>) {
  const alert = site.presentCount === 0;

  return (
    <Link
      className={`block rounded-lg border p-4 shadow-panel transition active:scale-[0.99] ${
        alert ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'
      }`}
      href={`/mobile/sites/${encodeURIComponent(site.id)}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {alert ? (
              <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white">
                Alerte
              </span>
            ) : null}
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
              {formatSiteStatus(site.status)}
            </span>
          </div>
          <h3 className="mt-3 truncate text-base font-black text-slate-950">{site.name}</h3>
          <p className="mt-1 truncate text-sm font-medium text-slate-500">{site.projectName}</p>
        </div>
        <ChevronRightIcon className="mt-2 h-5 w-5 shrink-0 text-slate-400" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <MetricTile label="Presents" value={`${site.presentCount}/${site.totalResources}`} />
        <MetricTile label="Dernier pointage" value={formatClockInTime(site.lastClockInAt)} />
      </div>
    </Link>
  );
}

function MetricTile({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-lg bg-white/80 p-3">
      <div className="truncate text-base font-black text-slate-950">{value}</div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
    </div>
  );
}

function AlertRow({ alert }: Readonly<{ alert: MobileManagementAlertItem }>) {
  return (
    <Link
      className="block rounded-lg border border-red-200 bg-white p-3 shadow-panel transition active:scale-[0.99]"
      href={`/mobile/sites/${encodeURIComponent(alert.siteId)}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-700">
          <AlertIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-black text-slate-950">{alert.title}</p>
            <span className="shrink-0 text-[11px] font-semibold text-slate-400">
              {formatEventTime(alert.occurredAt)}
            </span>
          </div>
          <p className="mt-1 truncate text-xs font-semibold text-slate-500">
            {alert.siteName} - {alert.projectName}
          </p>
          <p className="mt-1 text-sm leading-5 text-slate-600">{alert.description}</p>
        </div>
      </div>
    </Link>
  );
}

function PhotoThumb({ photo }: Readonly<{ photo: MobileManagementPhotoItem }>) {
  return (
    <Link
      className="relative aspect-square overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
      href={`/mobile/photo?siteId=${encodeURIComponent(photo.siteId)}`}
      title={photo.siteName}
    >
      <SignedImage photoId={photo.id} alt={photo.filename} className="object-cover" fill sizes="96px" />
      <div className="absolute inset-x-0 bottom-0 bg-slate-950/70 px-1.5 py-1 text-[10px] font-semibold text-white">
        <span className="block truncate">{photo.siteName}</span>
      </div>
    </Link>
  );
}

function EmptyPanel({ text }: Readonly<{ text: string }>) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm font-semibold text-slate-500">
      {text}
    </div>
  );
}

function DashboardLoadingState() {
  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3">
        <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-28 animate-pulse rounded-lg bg-slate-100" />
      </section>
      <section className="space-y-3">
        <div className="h-5 w-32 animate-pulse rounded bg-slate-100" />
        <div className="h-36 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-36 animate-pulse rounded-lg bg-slate-100" />
      </section>
    </div>
  );
}

function formatClockInTime(value: string | null) {
  if (!value) {
    return 'Aucun';
  }

  return new Intl.DateTimeFormat('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatEventTime(value: string | null) {
  if (!value) {
    return 'Nouveau';
  }

  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(value));
}

function formatSiteStatus(status: string) {
  if (status === 'ACTIVE') {
    return 'Actif';
  }

  return status.replaceAll('_', ' ').toLowerCase();
}

function baseIcon(className: string, children: ReactNode) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

function DashboardIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <path d="M4 13h6v7H4zM14 4h6v16h-6zM4 4h6v5H4z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
    </>,
  );
}

function ChevronRightIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <path d="m9 5 7 7-7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />,
  );
}

function AlertIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <path d="M12 4 3.5 19h17z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M12 9v4M12 16.5h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </>,
  );
}

function ProjectsIcon() {
  return baseIcon('h-5 w-5', <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />);
}

function SitesIcon() {
  return baseIcon('h-5 w-5', <path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" stroke="currentColor" strokeWidth="1.8" />);
}

function TeamsIcon() {
  return baseIcon('h-5 w-5', <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.5 20a5.5 5.5 0 0 1 11 0M17 11a2.5 2.5 0 1 0-.7-4.9M17 14.5a5 5 0 0 1 3.5 4.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />);
}

function PresenceIcon() {
  return baseIcon('h-5 w-5', <path d="M9 12 11 14 16 8M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />);
}

function ReportsIcon() {
  return baseIcon('h-5 w-5', <path d="M7 4h7l4 4v12H7V4ZM14 4v4h4M10 12h5M10 16h5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />);
}

function GalleryIcon() {
  return baseIcon('h-5 w-5', <path d="M4 6h16v12H4zM7 15l3-3 2 2 2-3 3 4M8 9h.01" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />);
}
