import type { PlanningObjectiveStatus } from '@/types/mobile-planning';

export type GeneralSupervisorKPIs = {
  deployedSupervisors: number;
  totalSupervisors: number;
  activeSupervisorsNow: number;
  reportsReceived: number;
  reportsExpected: number;
  alertCount: number;
  objectivesAchieved: number;
  objectivesPartial: number;
  objectivesBlocked: number;
  objectivesNotStarted: number;
};

export type TodayAssignment = {
  id: string;
  supervisorId: string;
  supervisorName: string;
  supervisorFirstName: string;
  siteId: string;
  siteName: string;
  siteAddress: string;
  progressPercentage: number;
  targetProgress: number | null;
  objectiveText: string | null;
  objectiveStatus: PlanningObjectiveStatus;
  actualProgress: number | null;
  progressDelta: number | null;
  isClockedIn: boolean;
  hasAlert: boolean;
  alertType?: 'ABSENCE' | 'LONG_SESSION' | 'MISSING_REPORT';
};

export type PriorityAlert = {
  id: string;
  type: 'ABSENCE' | 'LONG_SESSION' | 'MISSING_REPORT';
  supervisorId: string;
  supervisorName: string;
  supervisorFirstName: string;
  siteId: string;
  siteName: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
  createdAt: string;
  actionRequired: boolean;
};

export type GeneralSupervisorDashboardResponse = {
  kpis: GeneralSupervisorKPIs;
  todayAssignments: TodayAssignment[];
  priorityAlerts: PriorityAlert[];
  hasActiveSession: boolean;
  sessionData?: {
    siteId: string;
    siteName: string;
    arrivalAt: string;
    durationSeconds: number;
    isPaused: boolean;
    pauseDuration?: number;
  };
};
