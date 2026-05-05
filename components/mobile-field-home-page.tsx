'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import { haversineDistanceKm } from '@/lib/haversine';
import { getMobileOfflineCache, setMobileOfflineCache } from '@/lib/mobile-offline-db';
import type { WebSessionUser } from '@/lib/auth/web-session';
import type { SessionStatus, TodayClockInView } from '@/types/clock-in';
import type { TodaySiteItem } from '@/types/projects';

type TodaySitesResponse = {
  date: string;
  items: TodaySiteItem[];
};

type GeoState =
  | { status: 'loading' }
  | { status: 'ready'; latitude: number; longitude: number; accuracy: number | null }
  | { status: 'unavailable' };

type ClockInIntent = 'arrival' | 'departure' | 'pause-start' | 'pause-end';

type MobileFieldHomePageProps = Readonly<{
  user: WebSessionUser;
}>;

export function MobileFieldHomePage({ user }: MobileFieldHomePageProps) {
  const [now, setNow] = useState(() => Date.now());
  const geoState = useCurrentPosition();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const sitesQuery = useQuery({
    queryKey: ['mobile-sites-today'],
    queryFn: async () => {
      const response = await authFetch('/api/users/me/sites/today');

      if (!response.ok) {
        const cached = await getMobileOfflineCache<TodaySitesResponse>('sites-today');

        if (cached) {
          return cached.payload;
        }

        throw new Error(`Today sites request failed with status ${response.status}`);
      }

      const payload = (await response.json()) as TodaySitesResponse;
      await setMobileOfflineCache('sites-today', payload, 24 * 60 * 60 * 1000);
      return payload;
    },
    refetchInterval: 60_000,
    staleTime: 300_000,
  });

  const clockInQuery = useQuery({
    queryKey: ['mobile-clock-in-today'],
    queryFn: async () => {
      const response = await authFetch('/api/users/me/clock-in');

      if (!response.ok) {
        throw new Error(`Clock-in request failed with status ${response.status}`);
      }

      return (await response.json()) as TodayClockInView;
    },
    refetchInterval: 30_000,
    staleTime: 30_000,
  });

  const sites = useMemo(() => sitesQuery.data?.items ?? [], [sitesQuery.data?.items]);
  const activeSession = clockInQuery.data?.activeSession ?? null;
  const primarySite = useMemo(
    () => sites.find((site) => site.id === activeSession?.siteId) ?? sites[0] ?? null,
    [activeSession?.siteId, sites],
  );

  const sessionStatusQuery = useQuery({
    queryKey: ['mobile-session-status', primarySite?.id],
    queryFn: async () => {
      if (!primarySite) {
        return null;
      }

      const response = await authFetch(`/api/sites/${primarySite.id}/clock-in/session-status`);

      if (!response.ok) {
        return null;
      }

      return (await response.json()) as SessionStatus;
    },
    enabled: Boolean(primarySite),
    refetchInterval: 30_000,
    staleTime: 30_000,
  });

  const sessionStatus = sessionStatusQuery.data;
  const pauseActive = Boolean(sessionStatus?.pauseActive);
  const hasOpenSession = Boolean(sessionStatus?.sessionOpen ?? activeSession);
  const sessionStartedAt = sessionStatus?.arrivalTime ?? activeSession?.arrivalAt ?? null;
  const statusDurationSeconds = pauseActive
    ? calculateElapsedSeconds(sessionStatus?.arrivalTime, now, sessionStatus?.pauseDuration)
    : calculateElapsedSeconds(sessionStartedAt, now, sessionStatus?.duration ?? activeSession?.durationSeconds);
  const pauseDurationSeconds = calculateElapsedSeconds(null, now, sessionStatus?.pauseDuration);
  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
  const loading = sitesQuery.isLoading || clockInQuery.isLoading;

  return (
    <div className="space-y-5">
      <StatusBanner
        hasOpenSession={hasOpenSession}
        pauseActive={pauseActive}
        pauseDurationSeconds={pauseDurationSeconds}
        sessionDurationSeconds={statusDurationSeconds}
      />

      <section className="rounded-lg border border-sky-200 bg-sky-50 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-white">
            <CalendarCheckIcon className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-sky-950">Bonjour {user.firstName}</p>
            <p className="mt-1 text-sm text-sky-800">{formatLongDate(new Date())}</p>
          </div>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-bold text-white">
            {initials}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
            Chantier du jour
          </h2>
          {sites.length > 1 ? (
            <span className="text-xs font-semibold text-slate-400">{sites.length} sites</span>
          ) : null}
        </div>

        {loading ? <SitesLoadingState /> : null}

        {!loading && sites.length === 0 ? <EmptySitesState /> : null}

        {!loading && sites.length > 0 ? (
          <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2">
            {sites.map((site) => (
              <SiteCard
                currentPosition={geoState}
                key={site.id}
                selected={site.id === primarySite?.id}
                site={site}
              />
            ))}
          </div>
        ) : null}
      </section>

      {primarySite ? (
        <section className="space-y-3">
          <PrimaryActionButton
            intent={hasOpenSession ? 'departure' : 'arrival'}
            label={hasOpenSession ? 'POINTER SORTIE' : 'POINTER ENTRÉE'}
            siteId={primarySite.id}
            tone={hasOpenSession ? 'danger' : 'primary'}
          />

          {hasOpenSession ? (
            <PrimaryActionButton
              intent={pauseActive ? 'pause-end' : 'pause-start'}
              label={pauseActive ? 'REPRENDRE' : 'PAUSE'}
              siteId={primarySite.id}
              tone={pauseActive ? 'success' : 'warning'}
            />
          ) : null}
        </section>
      ) : null}

      {sitesQuery.isError || clockInQuery.isError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          Impossible de charger les donnees terrain. Verifiez la connexion puis reessayez.
        </div>
      ) : null}
    </div>
  );
}

function StatusBanner({
  hasOpenSession,
  pauseActive,
  pauseDurationSeconds,
  sessionDurationSeconds,
}: Readonly<{
  hasOpenSession: boolean;
  pauseActive: boolean;
  pauseDurationSeconds: number;
  sessionDurationSeconds: number;
}>) {
  if (pauseActive) {
    return (
      <div className="sticky top-0 z-20 rounded-lg border border-orange-200 bg-orange-100 px-4 py-3 text-sm font-bold text-orange-900 shadow-sm">
        ⏸ Pause depuis {formatShortDuration(pauseDurationSeconds)}
      </div>
    );
  }

  if (hasOpenSession) {
    return (
      <div className="sticky top-0 z-20 rounded-lg border border-emerald-200 bg-emerald-100 px-4 py-3 text-sm font-bold text-emerald-900 shadow-sm">
        ✅ Pointé depuis {formatShortDuration(sessionDurationSeconds)}
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-20 rounded-lg border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-bold text-slate-600 shadow-sm">
      Non pointé
    </div>
  );
}

function SiteCard({
  currentPosition,
  selected,
  site,
}: Readonly<{
  currentPosition: GeoState;
  selected: boolean;
  site: TodaySiteItem;
}>) {
  const distanceKm =
    currentPosition.status === 'ready'
      ? haversineDistanceKm(
          {
            latitude: currentPosition.latitude,
            longitude: currentPosition.longitude,
          },
          {
            latitude: site.latitude,
            longitude: site.longitude,
          },
        )
      : null;
  const inRadius = distanceKm !== null ? distanceKm <= site.radiusKm : null;

  return (
    <article
      className={`min-w-[88%] snap-center rounded-lg border bg-white p-5 shadow-panel ${
        selected ? 'border-primary/30' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-bold text-slate-950">{site.name}</h3>
          <p className="mt-2 flex items-start gap-2 text-sm leading-5 text-slate-500">
            <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{site.address}</span>
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-success/10 px-3 py-1 text-xs font-bold text-success">
          {site.status === 'ACTIVE' ? 'Assigné' : site.status}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <MetricTile label="Rayon" value={`${site.radiusKm} km`} />
        <MetricTile
          label="Distance"
          value={
            distanceKm === null
              ? currentPosition.status === 'loading'
                ? '...'
                : 'N/A'
              : `${distanceKm.toFixed(2)} km`
          }
        />
        <MetricTile label="Session" value={site.hasOpenSession ? 'Ouverte' : 'Libre'} />
      </div>

      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-center text-sm font-semibold">
        {distanceKm === null ? (
          <span className="text-slate-500">
            {currentPosition.status === 'loading' ? 'Localisation en cours...' : 'Position non disponible'}
          </span>
        ) : inRadius ? (
          <span className="text-success">En zone de chantier</span>
        ) : (
          <span className="text-orange-700">Hors zone de chantier</span>
        )}
      </div>
    </article>
  );
}

function MetricTile({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-center">
      <div className="truncate text-base font-bold text-slate-950">{value}</div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </div>
    </div>
  );
}

function PrimaryActionButton({
  intent,
  label,
  siteId,
  tone,
}: Readonly<{
  intent: ClockInIntent;
  label: string;
  siteId: string;
  tone: 'danger' | 'primary' | 'success' | 'warning';
}>) {
  const toneClassName = {
    danger: 'bg-danger text-white shadow-red-900/20',
    primary: 'bg-orange-600 text-white shadow-orange-900/20',
    success: 'bg-success text-white shadow-emerald-900/20',
    warning: 'bg-warning text-slate-950 shadow-yellow-900/20',
  }[tone];

  return (
    <Link
      className={`flex min-h-20 w-full items-center justify-center rounded-lg px-5 text-center text-base font-black tracking-[0.08em] shadow-lg transition active:scale-[0.98] ${toneClassName}`}
      href={`/mobile/clock-in?siteId=${encodeURIComponent(siteId)}&intent=${intent}`}
    >
      {label}
    </Link>
  );
}

function SitesLoadingState() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-panel">
      <div className="h-5 w-2/3 animate-pulse rounded bg-slate-200" />
      <div className="mt-3 h-4 w-full animate-pulse rounded bg-slate-100" />
      <div className="mt-6 grid grid-cols-3 gap-2">
        <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
        <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
      </div>
    </div>
  );
}

function EmptySitesState() {
  return (
    <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-white text-slate-400">
        <CalendarCheckIcon className="h-7 w-7" />
      </div>
      <h3 className="mt-4 text-lg font-bold text-slate-900">
        Aucun chantier assigné aujourd&apos;hui
      </h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        Les chantiers assignes apparaitront ici des qu&apos;ils seront disponibles.
      </p>
    </section>
  );
}

function useCurrentPosition(): GeoState {
  const [geoState, setGeoState] = useState<GeoState>({ status: 'loading' });

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoState({ status: 'unavailable' });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoState({
          status: 'ready',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        });
      },
      () => {
        setGeoState({ status: 'unavailable' });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60_000,
        timeout: 10_000,
      },
    );
  }, []);

  return geoState;
}

function calculateElapsedSeconds(
  startedAt: string | null | undefined,
  now: number,
  fallbackSeconds: number | null | undefined,
) {
  if (startedAt) {
    return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  }

  return Math.max(0, fallbackSeconds ?? 0);
}

function formatShortDuration(totalSeconds: number) {
  const totalMinutes = Math.max(0, Math.floor(totalSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}min`;
  }

  return `${minutes}min`;
}

function formatLongDate(value: Date) {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(value);
}

function baseIcon(className: string, children: ReactNode) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

function CalendarCheckIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <path d="M7 3v3M17 3v3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <rect x="4" y="5" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4 10h16M9 15l2 2 4-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </>,
  );
}

function MapPinIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11Z" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
    </>,
  );
}
