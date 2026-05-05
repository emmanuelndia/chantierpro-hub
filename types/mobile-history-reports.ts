export type ReportStatus = 'SUBMITTED' | 'REVIEWED' | 'VALIDATED' | 'SENT';

export type ReportSummary = {
  id: string;
  siteId: string;
  siteName: string;
  date: string;
  progressPercentage: number;
  content: string;
  status: ReportStatus;
  photoCount: number;
  coordinatorComment?: string;
  createdAt: string;
  updatedAt: string;
};

export type ReportDetail = ReportSummary & {
  photos: Array<{
    id: string;
    filename: string;
    url: string;
    thumbnail?: string;
    takenAt: string;
    description?: string;
  }>;
  sessionInfo: {
    arrivalAt: string;
    departureAt: string;
    durationSeconds: number;
  };
};

export type ReportsStatistics = {
  reportsSubmittedThisMonth: number;
  averageProgressDeclared: number;
  totalReports: number;
  reportsByStatus: Record<ReportStatus, number>;
};

export type MobileReportsHistoryResponse = {
  reports: ReportSummary[];
  statistics: ReportsStatistics;
  hasMore: boolean;
  nextCursor?: string;
};
