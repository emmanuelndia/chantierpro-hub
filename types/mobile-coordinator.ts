export type CoordinatorKPIs = {
  activeSupervisors: number;
  reportsReceivedToday: number;
  pendingReports: number;
};

export type PendingReportItem = {
  id: string;
  supervisorId: string;
  supervisorName: string;
  supervisorFirstName: string;
  siteId: string;
  siteName: string;
  siteAddress: string;
  sessionEndedAt: string;
  reportDueAt: string;
};

export type RecentReportItem = {
  id: string;
  supervisorName: string;
  siteName: string;
  submittedAt: string;
  summary: string;
  status: 'SUBMITTED' | 'REVIEWED' | 'APPROVED';
};

export type CoordinatorDashboardResponse = {
  kpis: CoordinatorKPIs;
  pendingReports: PendingReportItem[];
  recentReports: RecentReportItem[];
};
