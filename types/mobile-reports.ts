export type ReportStatus = 'PENDING' | 'SUBMITTED' | 'REVIEWED' | 'VALIDATED' | 'SENT';

export type ReportFilter = 'all' | 'pending' | 'received' | 'site';

export type PendingReport = {
  id: string;
  supervisorId: string;
  supervisorName: string;
  supervisorFirstName: string;
  siteId: string;
  siteName: string;
  siteAddress: string;
  sessionEndedAt: string;
  reportDueAt: string;
  isOverdue: boolean;
};

export type ReceivedReport = {
  id: string;
  supervisorId: string;
  supervisorName: string;
  supervisorFirstName: string;
  siteId: string;
  siteName: string;
  submittedAt: string;
  content: string;
  status: ReportStatus;
  sessionDuration?: number;
  progressPercentage?: number;
  photoCount?: number;
};

export type ReportDetail = {
  id: string;
  supervisorId: string;
  supervisorName: string;
  supervisorFirstName: string;
  siteId: string;
  siteName: string;
  siteAddress: string;
  sessionStartedAt: string;
  sessionEndedAt: string;
  sessionDuration: number;
  progressPercentage: number;
  submittedAt: string;
  content: string;
  status: ReportStatus;
  photos: ReportPhoto[];
  coordinatorComment?: string;
};

export type ReportPhoto = {
  id: string;
  filename: string;
  url: string;
  takenAt: string;
  description?: string;
};

export type ReportsSummary = {
  totalExpected: number;
  totalReceived: number;
  pendingCount: number;
  receivedCount: number;
  progressPercentage: number;
};

export type CoordinatorReportsResponse = {
  summary: ReportsSummary;
  pendingReports: PendingReport[];
  receivedReports: ReceivedReport[];
  sites: Array<{
    id: string;
    name: string;
  }>;
};

export type ReportValidationRequest = {
  reportId: string;
  coordinatorComment?: string;
};

export type ReportStatusUpdate = {
  status: ReportStatus;
  updatedAt: string;
};
