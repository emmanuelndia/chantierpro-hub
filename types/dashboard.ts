import type { Role } from '@prisma/client';
import type { AdminDeletionLogItem } from '@/types/admin-logs';
import type {
  DirectionAlertsResponse,
  DirectionConsolidatedProjectItem,
  DirectionKpisResponse,
} from '@/types/direction';
import type { RhExportHistoryItem, RhPresenceSummaryItem } from '@/types/rh';

export type DashboardSupportedRole =
  | 'PROJECT_MANAGER'
  | 'HR'
  | 'DIRECTION'
  | 'ADMIN'
  | 'COORDINATOR'
  | 'GENERAL_SUPERVISOR';

export type DashboardStat = {
  label: string;
  value: number | string;
  delta?: number | null;
  deltaLabel?: string;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'neutral';
  icon:
    | 'projects'
    | 'users'
    | 'sites'
    | 'photos'
    | 'reports'
    | 'clock'
    | 'exports'
    | 'alerts'
    | 'planning'
    | 'shield';
};

export type DashboardAlertItem = {
  id: string;
  level: 'error' | 'warning' | 'info';
  title: string;
  description: string;
  badge?: string;
};

export type DashboardReportItem = {
  id: string;
  siteId: string;
  siteName: string;
  authorName: string;
  submittedAt: string;
  excerpt: string;
};

export type CoordinatorFieldSession = {
  siteId: string;
  siteName: string;
  arrivalAt: string;
  durationSeconds: number;
} | null;

export type CoordinatorKpisToday = {
  activeSupervisorsNow: number;
  reportsReceivedToday: number;
  reportsMissing: number;
  reportsValidatedForClient: number;
};

export type CoordinatorPendingReportItem = {
  id: string;
  siteId: string;
  siteName: string;
  supervisorId: string;
  supervisorName: string;
  submittedAt: string;
  progressPercent: number;
  excerpt: string;
};

export type CoordinatorSupervisorWithoutReportItem = {
  id: string;
  siteId: string;
  siteName: string;
  supervisorId: string;
  supervisorName: string;
  endedAt: string;
  pushTokenCount: number;
};

export type DashboardPhotoItem = {
  id: string;
  siteId: string;
  siteName: string;
  filename: string;
  createdAt: string;
  url: string | null;
};

export type DashboardAdminRoleCount = {
  role: Role;
  active: number;
  total: number;
};

export type ProjectManagerDashboardData = {
  role: 'PROJECT_MANAGER';
  generatedAt: string;
  stats: DashboardStat[];
  latestPhotos: DashboardPhotoItem[];
  latestReports: DashboardReportItem[];
  alerts: DashboardAlertItem[];
};

export type HrDashboardData = {
  role: 'HR';
  generatedAt: string;
  stats: DashboardStat[];
  topResources: RhPresenceSummaryItem[];
  latestExports: RhExportHistoryItem[];
  alerts: DashboardAlertItem[];
};

export type DirectionDashboardData = {
  role: 'DIRECTION';
  generatedAt: string;
  stats: DashboardStat[];
  kpis: DirectionKpisResponse;
  consolidatedProjects: DirectionConsolidatedProjectItem[];
  alerts: DirectionAlertsResponse;
};

export type AdminDashboardData = {
  role: 'ADMIN';
  generatedAt: string;
  stats: DashboardStat[];
  usersByRole: DashboardAdminRoleCount[];
  latestDeletions: AdminDeletionLogItem[];
  alerts: DashboardAlertItem[];
};

export type CoordinatorDashboardData = {
  role: 'COORDINATOR';
  generatedAt: string;
  stats: DashboardStat[];
  fieldSession: CoordinatorFieldSession;
  kpisToday: CoordinatorKpisToday;
  pendingValidationReports: CoordinatorPendingReportItem[];
  supervisorsWithoutReport: CoordinatorSupervisorWithoutReportItem[];
  recentReports: DashboardReportItem[];
  alerts: DashboardAlertItem[];
};

export type GeneralSupervisorDashboardData = {
  role: 'GENERAL_SUPERVISOR';
  generatedAt: string;
  stats: DashboardStat[];
  recentReports: DashboardReportItem[];
  alerts: DashboardAlertItem[];
};

export type DashboardResponse =
  | ProjectManagerDashboardData
  | HrDashboardData
  | DirectionDashboardData
  | AdminDashboardData
  | CoordinatorDashboardData
  | GeneralSupervisorDashboardData;

export type DashboardApiErrorCode = 'FORBIDDEN';
