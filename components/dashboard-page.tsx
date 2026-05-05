'use client';

import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Badge } from '@/components/badge';
import { DataTable } from '@/components/data-table';
import { EmptyState } from '@/components/empty-state';
import { StatsCard } from '@/components/stats-card';
import { authFetch } from '@/lib/auth/client-session';
import type {
  DashboardAdminRoleCount,
  DashboardAlertItem,
  DashboardPhotoItem,
  DashboardReportItem,
  DashboardResponse,
} from '@/types/dashboard';
import type { AdminDeletionLogItem } from '@/types/admin-logs';
import type { DirectionConsolidatedProjectItem } from '@/types/direction';
import type { RhExportHistoryItem, RhPresenceSummaryItem } from '@/types/rh';
import type { DataTableColumn } from '@/types/ui';

const REFRESH_INTERVAL_MS = 30_000;

export function DashboardPage() {
  const query = useQuery({
    queryKey: ['dashboard'],
    queryFn: fetchDashboard,
    refetchInterval: REFRESH_INTERVAL_MS,
    staleTime: 30_000,
  });

  if (query.isLoading || !query.data) {
    return <DashboardLoadingState />;
  }

  if (query.isError) {
    return (
      <EmptyState
        title="Dashboard indisponible"
        description="Les widgets n'ont pas pu etre charges pour le moment. Rafraichis la page ou reessaie dans quelques instants."
      />
    );
  }

  return <DashboardContent data={query.data} />;
}

async function fetchDashboard() {
  const response = await authFetch('/api/dashboard');

  if (!response.ok) {
    throw new Error(`Dashboard request failed with status ${response.status}`);
  }

  return (await response.json()) as DashboardResponse;
}

function DashboardContent({ data }: Readonly<{ data: DashboardResponse }>) {
  switch (data.role) {
    case 'PROJECT_MANAGER':
      return (
        <DashboardFrame
          title="Pilotage projet"
          description="Vue rapide des chantiers en cours, des equipes presentes et des remontees recentes."
        >
          <StatsGrid stats={data.stats} />
          <TwoColumnLayout
            left={<PhotoGallery photos={data.latestPhotos} title="4 dernieres photos" />}
            right={<AlertsPanel alerts={data.alerts} title="Alertes sites sans presence > 2 jours" />}
          />
          <ReportsPanel reports={data.latestReports} title="5 derniers rapports soumis" />
        </DashboardFrame>
      );
    case 'HR':
      return (
        <DashboardFrame
          title="Synthese RH"
          description="Suivi mensuel des heures, exports recents et ressources a surveiller."
        >
          <StatsGrid stats={data.stats} />
          <TwoColumnLayout
            left={<TopResourcesPanel items={data.topResources} />}
            right={<ExportsPanel items={data.latestExports} />}
          />
          <AlertsPanel alerts={data.alerts} title="Alertes ressources sans pointage > 5 jours ouvres" />
        </DashboardFrame>
      );
    case 'DIRECTION':
      return (
        <DashboardFrame
          title="Vue Direction"
          description="KPIs globaux, tendances mensuelles et consolidation multi-projets."
        >
          <StatsGrid stats={data.stats} />
          <DirectionKpiStrip data={data} />
          <DirectionProjectsPanel items={data.consolidatedProjects} />
          <DirectionAlertsPanel data={data.alerts} />
        </DashboardFrame>
      );
    case 'ADMIN':
      return (
        <DashboardFrame
          title="Supervision administrateur"
          description="Population utilisateurs, suppressions recentes et alertes systeme."
        >
          <StatsGrid stats={data.stats} />
          <TwoColumnLayout
            left={<UsersByRolePanel items={data.usersByRole} />}
            right={<LatestDeletionsPanel items={data.latestDeletions} />}
          />
          <AlertsPanel alerts={data.alerts} title="Alertes systeme" />
        </DashboardFrame>
      );
    case 'COORDINATOR':
      return (
        <DashboardFrame
          title="Rapports terrain"
          description="Priorite aux remontees du terrain, a l'activite recente et aux points de relecture."
        >
          <StatsGrid stats={data.stats} />
          <TwoColumnLayout
            left={<ReportsPanel reports={data.recentReports} title="Rapports recents" />}
            right={<AlertsPanel alerts={data.alerts} title="Alertes a traiter" />}
          />
        </DashboardFrame>
      );
    case 'GENERAL_SUPERVISOR':
      return (
        <DashboardFrame
          title="Coordination terrain"
          description="Lecture rapide des affectations, equipes actives et alertes de coordination."
        >
          <StatsGrid stats={data.stats} />
          <TwoColumnLayout
            left={<ReportsPanel reports={data.recentReports} title="Rapports recents" />}
            right={<AlertsPanel alerts={data.alerts} title="Alertes coordination terrain" />}
          />
        </DashboardFrame>
      );
    default:
      return (
        <EmptyState
          title="Dashboard non disponible"
          description="Ce role n'a pas de dashboard web dedie dans cette iteration."
        />
      );
  }
}

function DashboardFrame({
  title,
  description,
  children,
}: Readonly<{
  title: string;
  description: string;
  children: ReactNode;
}>) {
  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-orange-600">Dashboard</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{description}</p>
      </section>
      {children}
    </div>
  );
}

function StatsGrid({ stats }: Readonly<{ stats: DashboardResponse['stats'] }>) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => (
        <StatsCard key={stat.label} stat={stat} />
      ))}
    </section>
  );
}

function TwoColumnLayout({
  left,
  right,
}: Readonly<{
  left: ReactNode;
  right: ReactNode;
}>) {
  return <section className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">{left}{right}</section>;
}

function SectionCard({
  title,
  subtitle,
  children,
}: Readonly<{
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}>) {
  return (
    <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
      <div className="mb-5">
        <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
        {subtitle ? <p className="mt-2 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

function PhotoGallery({ photos, title }: Readonly<{ photos: DashboardPhotoItem[]; title: string }>) {
  return (
    <SectionCard title={title} subtitle="Captures recentes remontees depuis les chantiers.">
      {photos.length === 0 ? (
        <CompactEmptyState message="Aucune photo recente a afficher." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {photos.map((photo) => (
            <article key={photo.id} className="overflow-hidden rounded-3xl border border-slate-200">
              <div className="relative h-40 w-full bg-slate-100">
                <Image
                  alt={photo.filename}
                  className="object-cover"
                  fill
                  sizes="(min-width: 640px) 50vw, 100vw"
                  src={`/api/photos/${encodeURIComponent(photo.id)}/content`}
                  unoptimized
                />
              </div>
              <div className="space-y-2 p-4">
                <p className="truncate text-sm font-semibold text-slate-900">{photo.filename}</p>
                <p className="text-sm text-slate-500">{photo.siteName}</p>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                  {formatDateTime(photo.createdAt)}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function ReportsPanel({ reports, title }: Readonly<{ reports: DashboardReportItem[]; title: string }>) {
  return (
    <SectionCard title={title} subtitle="Dernieres remontees terrain disponibles.">
      {reports.length === 0 ? (
        <CompactEmptyState message="Aucun rapport recent pour le moment." />
      ) : (
        <div className="space-y-4">
          {reports.map((report) => (
            <article key={report.id} className="rounded-3xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">{report.siteName}</p>
                  <p className="text-sm text-slate-500">{report.authorName}</p>
                </div>
                <Badge tone="neutral">{formatDateTime(report.submittedAt)}</Badge>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">{report.excerpt}</p>
            </article>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function AlertsPanel({ alerts, title }: Readonly<{ alerts: DashboardAlertItem[]; title: string }>) {
  return (
    <SectionCard title={title} subtitle="Points d'attention qui meritent une action rapide.">
      {alerts.length === 0 ? (
        <CompactEmptyState message="Aucune alerte critique pour le moment." />
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => (
            <article key={alert.id} className="rounded-3xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={alert.level === 'error' ? 'error' : alert.level === 'warning' ? 'warning' : 'info'}>
                  {alert.badge ?? alert.level}
                </Badge>
                <h3 className="font-semibold text-slate-900">{alert.title}</h3>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">{alert.description}</p>
            </article>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function TopResourcesPanel({ items }: Readonly<{ items: RhPresenceSummaryItem[] }>) {
  return (
    <SectionCard title="Top 5 ressources heures" subtitle="Heures travaillees cumulees hors pauses sur le mois courant.">
      {items.length === 0 ? (
        <CompactEmptyState message="Aucune donnee RH disponible pour ce mois." />
      ) : (
        <div className="space-y-4">
          {items.map((item, index) => (
            <article key={item.userId} className="flex items-center justify-between rounded-3xl border border-slate-200 p-4">
              <div>
                <p className="font-semibold text-slate-900">
                  {index + 1}. {item.firstName} {item.lastName}
                </p>
                <p className="text-sm text-slate-500">
                  {item.nbSessions} session(s) • {item.lastSite ?? 'Aucun chantier recent'}
                </p>
              </div>
              <Badge tone="success">{item.totalHours.toFixed(2)} h</Badge>
            </article>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function ExportsPanel({ items }: Readonly<{ items: RhExportHistoryItem[] }>) {
  return (
    <SectionCard title="5 derniers exports" subtitle="Historique recent des exports RH generes.">
      {items.length === 0 ? (
        <CompactEmptyState message="Aucun export RH recemment genere." />
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <article key={item.id} className="rounded-3xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">
                    Export {item.format.toUpperCase()} • {item.rowCount} ligne(s)
                  </p>
                  <p className="text-sm text-slate-500">
                    {item.createdBy.firstName} {item.createdBy.lastName} • {item.createdBy.role}
                  </p>
                </div>
                <Badge tone="neutral">{formatDateTime(item.createdAt)}</Badge>
              </div>
            </article>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function DirectionKpiStrip({ data }: Readonly<{ data: Extract<DashboardResponse, { role: 'DIRECTION' }> }>) {
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <MiniMetricCard
        label="Projets"
        value={`${data.kpis.projects.inProgress} en cours / ${data.kpis.projects.completed} termines`}
        helpText={`${data.kpis.projects.onHold} en pause`}
      />
      <MiniMetricCard
        label="Presences"
        value={`${data.kpis.presences.currentMonth} ce mois`}
        helpText={`M-1: ${data.kpis.presences.previousMonth} • delta ${formatDeltaValue(data.kpis.presences.deltaPercent)}`}
      />
      <MiniMetricCard
        label="Photos"
        value={`${data.kpis.photos.currentMonth} ce mois`}
        helpText={`M-1: ${data.kpis.photos.previousMonth} • delta ${formatDeltaValue(data.kpis.photos.deltaPercent)}`}
      />
    </section>
  );
}

function MiniMetricCard({
  label,
  value,
  helpText,
}: Readonly<{ label: string; value: string; helpText: string }>) {
  return (
    <article className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-panel">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-slate-950">{value}</p>
      <p className="mt-2 text-sm text-slate-500">{helpText}</p>
    </article>
  );
}

function DirectionProjectsPanel({ items }: Readonly<{ items: DirectionConsolidatedProjectItem[] }>) {
  const columns: readonly DataTableColumn<DirectionConsolidatedProjectItem>[] = [
    {
      id: 'project',
      header: 'Projet',
      accessor: (row) => (
        <div>
          <p className="font-semibold text-slate-900">{row.projectName}</p>
          <p className="text-xs text-slate-500">{row.projectManager.firstName} {row.projectManager.lastName}</p>
        </div>
      ),
      sortValue: (row) => row.projectName,
      filterValue: (row) => `${row.projectName} ${row.projectManager.firstName} ${row.projectManager.lastName}`,
    },
    {
      id: 'status',
      header: 'Statut',
      accessor: (row) => <Badge tone={projectStatusTone(row.projectStatus)}>{row.projectStatus}</Badge>,
      sortValue: (row) => row.projectStatus,
      filterValue: (row) => row.projectStatus,
    },
    {
      id: 'sites',
      header: 'Nb chantiers',
      accessor: (row) => row.sitesCount,
      sortValue: (row) => row.sitesCount,
      filterValue: (row) => String(row.sitesCount),
    },
    {
      id: 'resources',
      header: 'Nb ressources',
      accessor: (row) => row.resourcesCount,
      sortValue: (row) => row.resourcesCount,
      filterValue: (row) => String(row.resourcesCount),
    },
    {
      id: 'hours',
      header: 'Heures mois',
      accessor: (row) => `${row.hoursMonth.toFixed(2)} h`,
      sortValue: (row) => row.hoursMonth,
      filterValue: (row) => String(row.hoursMonth),
    },
    {
      id: 'photos',
      header: 'Photos mois',
      accessor: (row) => row.photosMonth,
      sortValue: (row) => row.photosMonth,
      filterValue: (row) => String(row.photosMonth),
    },
    {
      id: 'alerts',
      header: 'Alertes',
      accessor: (row) => <Badge tone={row.alertsCount > 0 ? 'error' : 'success'}>{row.alertsCount}</Badge>,
      sortValue: (row) => row.alertsCount,
      filterValue: (row) => String(row.alertsCount),
    },
  ];

  return (
    <DataTable
      columns={columns}
      pageSize={6}
      rowKey={(row) => row.projectId}
      rows={items}
      searchPlaceholder="Filtrer par projet ou chef de projet..."
    />
  );
}

function DirectionAlertsPanel({ data }: Readonly<{ data: Extract<DashboardResponse, { role: 'DIRECTION' }>['alerts'] }>) {
  return (
    <section className="grid gap-6 xl:grid-cols-3">
      <AlertsListCard
        title="Sites sans presence"
        items={data.sitesWithoutPresence.map((item) => ({
          id: item.siteId,
          title: item.siteName,
          description: item.lastPresenceAt
            ? `Derniere presence le ${formatDateTime(item.lastPresenceAt)}`
            : 'Aucune presence connue sur ce chantier.',
          tone: 'error' as const,
        }))}
      />
      <AlertsListCard
        title="Sessions incompletes"
        items={data.incompleteSessions.map((item) => ({
          id: `${item.userId}:${item.siteId}`,
          title: `${item.firstName} ${item.lastName}`,
          description: `${item.siteName} • ouverte depuis ${item.hoursOpen} h`,
          tone: 'warning' as const,
        }))}
      />
      <AlertsListCard
        title="Ressources absentes"
        items={data.absentResources.map((item) => ({
          id: `${item.userId}:${item.siteId}`,
          title: `${item.firstName} ${item.lastName}`,
          description: `${item.siteName} • ${item.workingDaysAbsent} jours ouvres sans pointage`,
          tone: 'info' as const,
        }))}
      />
    </section>
  );
}

function AlertsListCard({
  title,
  items,
}: Readonly<{
  title: string;
  items: { id: string; title: string; description: string; tone: 'error' | 'warning' | 'info' }[];
}>) {
  return (
    <SectionCard title={title}>
      {items.length === 0 ? (
        <CompactEmptyState message="Aucune alerte pour ce volet." />
      ) : (
        <div className="space-y-3">
          {items.slice(0, 5).map((item) => (
            <div key={item.id} className="rounded-3xl border border-slate-200 p-4">
              <Badge tone={item.tone}>{item.tone}</Badge>
              <p className="mt-3 font-semibold text-slate-900">{item.title}</p>
              <p className="mt-2 text-sm text-slate-500">{item.description}</p>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function UsersByRolePanel({ items }: Readonly<{ items: DashboardAdminRoleCount[] }>) {
  const columns: readonly DataTableColumn<DashboardAdminRoleCount>[] = [
    {
      id: 'role',
      header: 'Role',
      accessor: (row) => row.role,
      sortValue: (row) => row.role,
      filterValue: (row) => row.role,
    },
    {
      id: 'active',
      header: 'Actifs',
      accessor: (row) => row.active,
      sortValue: (row) => row.active,
      filterValue: (row) => String(row.active),
    },
    {
      id: 'total',
      header: 'Total',
      accessor: (row) => row.total,
      sortValue: (row) => row.total,
      filterValue: (row) => String(row.total),
    },
  ];

  return (
    <DataTable
      columns={columns}
      pageSize={7}
      rowKey={(row) => row.role}
      rows={items}
      searchPlaceholder="Filtrer par role..."
    />
  );
}

function LatestDeletionsPanel({ items }: Readonly<{ items: AdminDeletionLogItem[] }>) {
  return (
    <SectionCard title="5 dernieres suppressions de photos" subtitle="Historique recent des suppressions auditees.">
      {items.length === 0 ? (
        <CompactEmptyState message="Aucune suppression recente." />
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <article key={item.id} className="rounded-3xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-semibold text-slate-900">{item.site.name}</p>
                <Badge tone="error">{formatDateTime(item.deletedAt)}</Badge>
              </div>
              <p className="mt-3 text-sm text-slate-600">
                Supprime par {item.deletedBy.firstName} {item.deletedBy.lastName} ({item.deletedBy.role})
              </p>
              <p className="mt-2 text-sm text-slate-500">Auteur original : {item.originalAuthor.firstName} {item.originalAuthor.lastName}</p>
              <p className="mt-3 text-sm leading-6 text-slate-600">{item.reason}</p>
            </article>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function CompactEmptyState({ message }: Readonly<{ message: string }>) {
  return <p className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">{message}</p>;
}

function DashboardLoadingState() {
  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel">
        <div className="h-4 w-28 animate-pulse rounded-full bg-slate-200" />
        <div className="mt-4 h-10 w-72 animate-pulse rounded-full bg-slate-200" />
        <div className="mt-4 h-4 w-full animate-pulse rounded-full bg-slate-100" />
      </section>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-40 animate-pulse rounded-3xl border border-slate-200 bg-white shadow-panel" />
        ))}
      </section>
      <section className="grid gap-6 xl:grid-cols-2">
        <div className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
        <div className="h-96 animate-pulse rounded-[2rem] border border-slate-200 bg-white shadow-panel" />
      </section>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatDeltaValue(value: number | null) {
  if (value === null) {
    return 'n/a';
  }

  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)} %`;
}

function projectStatusTone(status: DirectionConsolidatedProjectItem['projectStatus']) {
  switch (status) {
    case 'IN_PROGRESS':
      return 'success' as const;
    case 'ON_HOLD':
      return 'warning' as const;
    case 'COMPLETED':
      return 'neutral' as const;
    case 'ARCHIVED':
      return 'info' as const;
    default:
      return 'neutral' as const;
  }
}
