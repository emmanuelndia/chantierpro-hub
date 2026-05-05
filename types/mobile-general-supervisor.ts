export type GeneralSupervisorKPIs = {
  deployedSupervisors: number;
  totalSupervisors: number;
  activeSupervisorsNow: number;
  reportsReceived: number;
  reportsExpected: number;
  alertCount: number;
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
