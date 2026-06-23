'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type { PaginatedAdminDeletionLogsResponse } from '@/types/admin-logs';
import type { PaginatedPhotosResponse } from '@/types/photos';
import type { PaginatedUsersResponse } from '@/types/users';

type MobileAdminDashboardPageProps = Readonly<{
  user: WebSessionUser;
}>;

export function MobileAdminDashboardPage({ user }: MobileAdminDashboardPageProps) {
  const dashboardQuery = useQuery({
    queryKey: ['mobile-admin-dashboard'],
    queryFn: async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [activeUsers, inactiveUsers, photos, logs] = await Promise.all([
        fetchJson<PaginatedUsersResponse>('/api/users?page=1&status=active&limit=1'),
        fetchJson<PaginatedUsersResponse>('/api/users?page=1&status=inactive&limit=1'),
        fetchJson<PaginatedPhotosResponse>(`/api/mobile/photos/gallery?page=1&from=${encodeURIComponent(sevenDaysAgo)}`),
        fetchJson<PaginatedAdminDeletionLogsResponse>(`/api/admin/logs?page=1&from=${encodeURIComponent(sevenDaysAgo)}`),
      ]);

      return {
        activeUsers: activeUsers.totalItems,
        inactiveUsers: inactiveUsers.totalItems,
        recentPhotos: photos.totalItems,
        recentDeletions: logs.totalItems,
      };
    },
    staleTime: 30_000,
  });

  return (
    <div className="space-y-5 pb-20">
      <section className="rounded-lg border border-primary/20 bg-primary/10 p-4">
        <p className="text-sm font-bold text-slate-950">Administration mobile</p>
        <p className="mt-1 text-sm text-slate-600">
          Bonjour {user.firstName}, les outils utiles sur telephone sont ici.
        </p>
      </section>

      {dashboardQuery.isLoading ? (
        <section className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </section>
      ) : null}

      {dashboardQuery.isError ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          Impossible de charger le resume admin.
        </section>
      ) : null}

      {dashboardQuery.data ? (
        <section className="grid grid-cols-2 gap-3">
          <MetricCard label="Utilisateurs actifs" value={dashboardQuery.data.activeUsers} tone="emerald" />
          <MetricCard label="Utilisateurs inactifs" value={dashboardQuery.data.inactiveUsers} tone="amber" />
          <MetricCard label="Photos recentes" value={dashboardQuery.data.recentPhotos} tone="sky" />
          <MetricCard label="Suppressions" value={dashboardQuery.data.recentDeletions} tone="rose" />
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">Acces rapides</h2>
        <div className="grid grid-cols-2 gap-3">
          <QuickAction href="/mobile/users" icon={<UsersIcon />} label="Utilisateurs" />
          <QuickAction href="/mobile/clock-in" icon={<ClockIcon />} label="Pointage" />
          <QuickAction href="/mobile/site-map" icon={<MapIcon />} label="Cartographie" />
          <QuickAction href="/mobile/presences" icon={<PresenceIcon />} label="Presences" />
          <QuickAction href="/mobile/gallery" icon={<GalleryIcon />} label="Galerie" />
          <QuickAction href="/mobile/logs" icon={<LogsIcon />} label="Logs" />
          <QuickAction href="/mobile/profile" icon={<ProfileIcon />} label="Profil" />
        </div>
      </section>
    </div>
  );
}

async function fetchJson<T>(url: string) {
  const response = await authFetch(url);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

function MetricCard({
  label,
  value,
  tone,
}: Readonly<{
  label: string;
  value: number;
  tone: 'emerald' | 'amber' | 'sky' | 'rose';
}>) {
  const colors = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    sky: 'border-sky-200 bg-sky-50 text-sky-800',
    rose: 'border-rose-200 bg-rose-50 text-rose-800',
  }[tone];

  return (
    <article className={`rounded-lg border p-4 ${colors}`}>
      <p className="text-3xl font-black">{value}</p>
      <p className="mt-2 text-sm font-bold text-slate-950">{label}</p>
    </article>
  );
}

function QuickAction({
  href,
  icon,
  label,
}: Readonly<{
  href: string;
  icon: ReactNode;
  label: string;
}>) {
  return (
    <Link className="flex min-h-20 items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-panel" href={href}>
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
      <span className="text-sm font-black text-slate-950">{label}</span>
    </Link>
  );
}

function icon(children: ReactNode) {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

function UsersIcon() {
  return icon(<path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.5 20a5.5 5.5 0 0 1 11 0M17 11a2.5 2.5 0 1 0-.7-4.9M17 14.5a5 5 0 0 1 3.5 4.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />);
}

function ClockIcon() {
  return icon(<path d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />);
}

function MapIcon() {
  return icon(<><path d="M9 18 4 20V6l5-2 6 2 5-2v14l-5 2-6-2Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" /><path d="M9 4v14M15 6v14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></>);
}

function PresenceIcon() {
  return icon(<><path d="M5 6h14M5 12h14M5 18h14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /><path d="M3 6h.01M3 12h.01M3 18h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="3" /></>);
}
function GalleryIcon() {
  return icon(<path d="M4 6h16v12H4zM7 15l3-3 2 2 2-3 3 4M8 9h.01" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />);
}

function LogsIcon() {
  return icon(<path d="M4 12a8 8 0 1 0 3-6M4 4v5h5M12 8v4l2 2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />);
}

function ProfileIcon() {
  return icon(<path d="M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM5 20a7 7 0 0 1 14 0" stroke="currentColor" strokeWidth="1.8" />);
}
