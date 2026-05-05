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
import type {
  GeneralSupervisorDashboardResponse,
  TodayAssignment,
  PriorityAlert,
} from '@/types/mobile-general-supervisor';

type TodaySitesResponse = {
  date: string;
  items: TodaySiteItem[];
};

type GeoState =
  | { status: 'loading' }
  | { status: 'ready'; latitude: number; longitude: number; accuracy: number | null }
  | { status: 'unavailable' };

type ClockInIntent = 'arrival' | 'departure' | 'pause-start' | 'pause-end';

type MobileGeneralSupervisorHomePageProps = Readonly<{
  user: WebSessionUser;
}>;

export function MobileGeneralSupervisorHomePage({ user }: MobileGeneralSupervisorHomePageProps) {
  const [now, setNow] = useState(() => Date.now());
  const geoState = useCurrentPosition();

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Données des sites du superviseur général
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

  // Données de pointage du superviseur général
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

  // Dashboard spécifique au superviseur général
  const dashboardQuery = useQuery({
    queryKey: ['mobile-general-supervisor-dashboard'],
    queryFn: async () => {
      const response = await authFetch('/api/mobile/general-supervisor/dashboard');

      if (!response.ok) {
        throw new Error(`General supervisor dashboard request failed with status ${response.status}`);
      }

      return (await response.json()) as GeneralSupervisorDashboardResponse;
    },
    refetchInterval: 60_000,
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
  const loading = sitesQuery.isLoading || clockInQuery.isLoading || dashboardQuery.isLoading;
  const dashboard = dashboardQuery.data;

  return (
    <div className="space-y-5">
      {/* Bandeau de session terrain */}
      <StatusBanner
        hasOpenSession={hasOpenSession}
        pauseActive={pauseActive}
        pauseDurationSeconds={pauseDurationSeconds}
        sessionDurationSeconds={statusDurationSeconds}
      />

      {/* Header avec informations utilisateur */}
      <section className="rounded-lg border border-purple-200 bg-purple-50 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-500 text-white">
            <SupervisorIcon className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-purple-950">Bonjour {user.firstName}</p>
            <p className="mt-1 text-sm text-purple-800">{formatLongDate(new Date())}</p>
          </div>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-bold text-white">
            {initials}
          </div>
        </div>
      </section>

      {/* KPIs globaux */}
      <section className="grid grid-cols-2 gap-3">
        {dashboardQuery.isLoading ? (
          <>
            <KPITileSkeleton />
            <KPITileSkeleton />
            <KPITileSkeleton />
            <KPITileSkeleton />
          </>
        ) : dashboardQuery.isError ? (
          <>
            <KPITile
              label="Superviseurs déployés"
              value="—"
              icon={<TeamIcon />}
              tone="default"
            />
            <KPITile
              label="Actifs maintenant"
              value="—"
              icon={<ActiveIcon />}
              tone="default"
            />
            <KPITile
              label="Rapports reçus"
              value="—"
              icon={<ReportIcon />}
              tone="default"
            />
            <KPITile
              label="Alertes"
              value="—"
              icon={<AlertIcon />}
              tone="default"
            />
          </>
        ) : (
          <>
            <KPITile
              label="Superviseurs déployés"
              value={`${dashboard?.kpis.deployedSupervisors ?? 0}/${dashboard?.kpis.totalSupervisors ?? 0}`}
              icon={<TeamIcon />}
              tone="primary"
            />
            <KPITile
              label="Actifs maintenant"
              value={dashboard?.kpis.activeSupervisorsNow.toString() ?? '0'}
              icon={<ActiveIcon />}
              tone="success"
            />
            <KPITile
              label="Rapports reçus"
              value={`${dashboard?.kpis.reportsReceived ?? 0}/${dashboard?.kpis.reportsExpected ?? 0}`}
              icon={<ReportIcon />}
              tone="info"
            />
            <KPITile
              label="Alertes"
              value={dashboard?.kpis.alertCount.toString() ?? '0'}
              icon={<AlertIcon />}
              tone={(dashboard?.kpis.alertCount ?? 0) > 0 ? 'danger' : 'default'}
              badge={(dashboard?.kpis.alertCount ?? 0) > 0}
            />
          </>
        )}
      </section>

      {/* Actions rapides (grille 2x2) */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
          Actions rapides
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <QuickActionCard
            href="/mobile/planning"
            icon={<CalendarIcon />}
            label="Faire le planning"
            description="Organiser les équipes"
            tone="primary"
          />
          <QuickActionCard
            href="/mobile/reports"
            icon={<ReportsIcon />}
            label="Rapports"
            description="Consulter les rapports"
            tone="secondary"
          />
          <QuickActionCard
            href="/mobile/teams"
            icon={<TeamIcon />}
            label="Équipes"
            description="Créer et gérer"
            tone="tertiary"
          />
          <QuickActionCard
            href="/mobile/photo?mode=camera"
            icon={<PhotoIcon />}
            label="Photo"
            description="Prendre une photo"
            tone="quaternary"
          />
        </div>
      </section>

      {/* Planning du jour */}
      {dashboardQuery.isLoading ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
              Planning du jour
            </h3>
          </div>
          <div className="space-y-2">
            <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
          </div>
        </section>
      ) : dashboardQuery.isError ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
              Planning du jour
            </h3>
          </div>
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-center text-sm text-orange-700">
            Impossible de charger le planning du jour
          </div>
        </section>
      ) : dashboard?.todayAssignments && dashboard.todayAssignments.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
              Planning du jour
            </h3>
            <Link
              className="text-xs font-semibold text-purple-600 hover:text-purple-700"
              href="/mobile/planning"
            >
              Modifier
            </Link>
          </div>
          <div className="space-y-2">
            {dashboard.todayAssignments.map((assignment) => (
              <AssignmentCard key={assignment.id} assignment={assignment} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Alertes prioritaires */}
      {dashboardQuery.isLoading ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
              Alertes prioritaires
            </h3>
          </div>
          <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
        </section>
      ) : dashboardQuery.isError ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
              Alertes prioritaires
            </h3>
          </div>
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-center text-sm text-orange-700">
            Impossible de charger les alertes
          </div>
        </section>
      ) : dashboard?.priorityAlerts && dashboard.priorityAlerts.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
              Alertes prioritaires
            </h3>
            <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-bold text-red-700">
              {dashboard.priorityAlerts.length}
            </span>
          </div>
          <div className="space-y-2">
            {dashboard.priorityAlerts.map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Site du jour et pointage */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-slate-500">
            Mon chantier
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

      {/* Actions de pointage */}
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

          </div>
  );
}

// Composants utilitaires
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

function KPITile({
  label,
  value,
  icon,
  tone,
  badge = false,
}: Readonly<{
  label: string;
  value: string;
  icon: ReactNode;
  tone: 'primary' | 'success' | 'info' | 'danger' | 'default';
  badge?: boolean;
}>) {
  const toneClasses = {
    primary: 'border-purple-200 bg-purple-50 text-purple-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    info: 'border-blue-200 bg-blue-50 text-blue-800',
    danger: 'border-red-200 bg-red-50 text-red-800',
    default: 'border-slate-200 bg-slate-50 text-slate-800',
  }[tone];

  return (
    <article className={`relative rounded-lg border p-3 ${toneClasses}`}>
      {badge && (
        <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-red-500" />
      )}
      <div className="flex items-center justify-center">
        <div className="h-5 w-5">{icon}</div>
      </div>
      <div className="mt-2 text-center">
        <div className="text-lg font-black">{value}</div>
        <div className="mt-1 text-xs font-semibold uppercase tracking-[0.12em]">{label}</div>
      </div>
    </article>
  );
}

function QuickActionCard({
  href,
  icon,
  label,
  description,
  tone,
}: Readonly<{
  href: string;
  icon: ReactNode;
  label: string;
  description: string;
  tone: 'primary' | 'secondary' | 'tertiary' | 'quaternary';
}>) {
  const toneClasses = {
    primary: 'border-purple-200 bg-purple-50 text-purple-800 hover:bg-purple-100',
    secondary: 'border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100',
    tertiary: 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
    quaternary: 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100',
  }[tone];

  return (
    <Link
      className={`block rounded-lg border p-4 transition active:scale-[0.98] ${toneClasses}`}
      href={href}
    >
      <div className="flex items-center gap-3">
        <div className="h-8 w-8">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">{label}</div>
          <div className="mt-1 text-xs opacity-75">{description}</div>
        </div>
      </div>
    </Link>
  );
}

function AssignmentCard({ assignment }: Readonly<{ assignment: TodayAssignment }>) {
  const progressColor = assignment.progressPercentage >= 80 ? 'text-emerald-600' : 
                       assignment.progressPercentage >= 50 ? 'text-orange-600' : 'text-red-600';

  return (
    <div className={`rounded-lg border p-3 ${
      assignment.hasAlert ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'
    }`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-sm font-bold text-slate-950">
              {assignment.supervisorFirstName} {assignment.supervisorName}
            </h4>
            {assignment.hasAlert && (
              <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                !
              </span>
            )}
            {assignment.isClockedIn && (
              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                ✓
              </span>
            )}
          </div>
          <p className="mt-1 truncate text-xs text-slate-600">{assignment.siteName}</p>
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1">
              <div className="h-1.5 w-full rounded-full bg-slate-200">
                <div 
                  className="h-1.5 rounded-full bg-purple-500 transition-all duration-300"
                  style={{ width: `${assignment.progressPercentage}%` }}
                />
              </div>
            </div>
            <span className={`text-xs font-semibold ${progressColor}`}>
              {assignment.progressPercentage}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AlertCard({ alert }: Readonly<{ alert: PriorityAlert }>) {
  const severityColors = {
    HIGH: 'border-red-200 bg-red-50 text-red-800',
    MEDIUM: 'border-orange-200 bg-orange-50 text-orange-800',
    LOW: 'border-yellow-200 bg-yellow-50 text-yellow-800',
  };

  const typeIcons = {
    ABSENCE: <UserAbsentIcon />,
    LONG_SESSION: <ClockIcon />,
    MISSING_REPORT: <ReportMissingIcon />,
  };

  return (
    <div className={`rounded-lg border p-3 ${severityColors[alert.severity]}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 h-5 w-5 shrink-0">
          {typeIcons[alert.type]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="truncate text-sm font-bold">
              {alert.supervisorFirstName} {alert.supervisorName}
            </p>
            <span className="shrink-0 text-[11px] font-semibold opacity-75">
              {formatEventTime(alert.createdAt)}
            </span>
          </div>
          <p className="mt-1 text-xs">{alert.siteName}</p>
          <p className="mt-1 text-xs leading-5">{alert.message}</p>
        </div>
      </div>
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
    primary: 'bg-purple-600 text-white shadow-purple-900/20',
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
        <SupervisorIcon className="h-7 w-7" />
      </div>
      <h3 className="mt-4 text-lg font-bold text-slate-900">
        Aucun chantier assigné aujourd&apos;hui
      </h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        Les chantiers assignés apparaîtront ici dès qu&apos;ils seront disponibles.
      </p>
    </section>
  );
}

// Hooks utilitaires
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

// Fonctions utilitaires
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

function formatEventTime(value: string | null) {
  if (!value) {
    return 'Nouveau';
  }

  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

// Icônes
function baseIcon(className: string, children: ReactNode) {
  return (
    <svg aria-hidden="true" className={className} fill="none" viewBox="0 0 24 24">
      {children}
    </svg>
  );
}

function SupervisorIcon({ className }: Readonly<{ className: string }>) {
  return baseIcon(
    className,
    <>
      <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </>,
  );
}

function TeamIcon() {
  return baseIcon(
    'h-5 w-5',
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </>,
  );
}

function ActiveIcon() {
  return baseIcon(
    'h-5 w-5',
    <>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 6v6l4 2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function ReportIcon() {
  return baseIcon(
    'h-5 w-5',
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <polyline points="14,2 14,8 20,8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function AlertIcon() {
  return baseIcon(
    'h-5 w-5',
    <>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
      <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function CalendarIcon() {
  return baseIcon(
    'h-8 w-8',
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <line x1="16" y1="2" x2="16" y2="6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <line x1="8" y1="2" x2="8" y2="6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function ReportsIcon() {
  return baseIcon(
    'h-8 w-8',
    <>
      <path d="M7 4h7l4 4v12H7V4Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M14 4v4h4M10 12h5M10 16h5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </>,
  );
}

function PhotoIcon() {
  return baseIcon(
    'h-8 w-8',
    <>
      <path d="M4 8h4l2-2h4l2 2h4v10H4V8Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      <circle cx="12" cy="13" r="3" stroke="currentColor" strokeWidth="1.8" />
    </>,
  );
}

function UserAbsentIcon() {
  return baseIcon(
    'h-5 w-5',
    <>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
      <line x1="8" y1="15" x2="16" y2="15" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M12 12h.01" stroke="currentColor" strokeWidth="1.8" />
    </>,
  );
}

function ClockIcon() {
  return baseIcon(
    'h-5 w-5',
    <>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 6v6l4 2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function ReportMissingIcon() {
  return baseIcon(
    'h-5 w-5',
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <path d="M14 2v4h4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
      <line x1="9" y1="15" x2="15" y2="15" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </>,
  );
}

function KPITileSkeleton() {
  return (
    <article className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-center">
        <div className="h-5 w-5 animate-pulse rounded bg-slate-300" />
      </div>
      <div className="mt-2 text-center">
        <div className="mx-auto h-6 w-12 animate-pulse rounded bg-slate-300" />
        <div className="mt-1 h-3 w-16 animate-pulse rounded bg-slate-200" />
      </div>
    </article>
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
