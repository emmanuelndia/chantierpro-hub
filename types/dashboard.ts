import type { Role } from '@prisma/client';
import type { PlanningObjectiveStatus, TaskProgressUpdateItem } from '@/types/mobile-planning';
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
  | 'AUDITOR'
  | 'COORDINATOR'
  | 'GENERAL_SUPERVISOR'
  | 'BE_MANAGER'
  | 'NEGOTIATION_MANAGER'
  | 'FLEET_MANAGER';

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
  siteId: string | null;
  siteName: string;
  authorName: string;
  submittedAt: string;
  excerpt: string;
};

export type CoordinatorFieldSession = {
  siteId: string | null;
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
  siteId: string | null;
  siteName: string;
  supervisorId: string;
  supervisorName: string;
  submittedAt: string;
  progressPercent: number;
  excerpt: string;
};

export type CoordinatorSupervisorWithoutReportItem = {
  id: string;
  siteId: string | null;
  siteName: string;
  supervisorId: string;
  supervisorName: string;
  endedAt: string;
  pushTokenCount: number;
};

export type GeneralSupervisorSiteDashboardItem = {
  id: string;
  name: string;
  address: string;
  projectName: string;
  assignmentsToday: number;
  reportsToday: number;
  activeTeams: number;
  presentToday: boolean;
};

export type GeneralSupervisorAssignmentDashboardItem = {
  id: string;
  supervisorName: string;
  supervisorRole: Role;
  siteName: string;
  projectName: string;
  action: string;
  targetProgress: number | null;
  targetQuantity: number | null;
  targetUnit: string | null;
  objectiveText: string | null;
  actualQuantity: number | null;
  actualProgress: number | null;
  progressDelta: number | null;
  remainingQuantity: number | null;
  objectiveStatus: PlanningObjectiveStatus;
  latestProgressUpdate: TaskProgressUpdateItem | null;
  status: string;
};

export type GeneralSupervisorResourceElsewhereItem = {
  id: string;
  name: string;
  role: Role;
  siteName: string;
  projectName: string;
  status: string;
};

export type GeneralSupervisorReportBySiteItem = {
  siteId: string;
  siteName: string;
  projectName: string;
  submittedToday: number;
  validatedForClientToday: number;
};

export type DashboardPhotoItem = {
  id: string;
  siteId: string | null;
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

export type AuditorVisitDashboardItem = {
  id: string;
  siteId: string;
  siteName: string;
  projectName: string;
  visitedAt: string;
  comment: string | null;
  latitude: number | null;
  longitude: number | null;
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

export type AuditorDashboardData = {
  role: 'AUDITOR';
  generatedAt: string;
  stats: DashboardStat[];
  recentVisits: AuditorVisitDashboardItem[];
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
  role: 'GENERAL_SUPERVISOR' | 'BE_MANAGER' | 'NEGOTIATION_MANAGER' | 'FLEET_MANAGER';
  generatedAt: string;
  stats: DashboardStat[];
  entrustedSites: GeneralSupervisorSiteDashboardItem[];
  assignmentsToday: GeneralSupervisorAssignmentDashboardItem[];
  resourcesAssignedElsewhere: GeneralSupervisorResourceElsewhereItem[];
  reportsBySite: GeneralSupervisorReportBySiteItem[];
  recentReports: DashboardReportItem[];
  alerts: DashboardAlertItem[];
};

export type DashboardResponse =
  | ProjectManagerDashboardData
  | HrDashboardData
  | DirectionDashboardData
  | AdminDashboardData
  | AuditorDashboardData
  | CoordinatorDashboardData
  | GeneralSupervisorDashboardData;

export type DashboardApiErrorCode = 'FORBIDDEN';
