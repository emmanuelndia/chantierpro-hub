import type { PhotoTag } from '@prisma/client';

export type ReportStatus = 'RECU' | 'EN_REVUE' | 'VALIDE' | 'ENVOYE';

export type ReportFilter = 'all' | 'pending' | 'received' | 'site';

export type MobileReportCoveragePeriod = 'today' | 'week';

export type PendingReport = {
  id: string;
  supervisorId: string;
  supervisorName: string;
  supervisorFirstName: string;
  siteId: string | null;
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
  siteId: string | null;
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
  siteId: string | null;
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
  tags: PhotoTag[];
  planningAssignmentId: string | null;
  assignmentAction?: string;
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
  siteCoverage: MobileReportSiteCoverageItem[];
  sites: {
    id: string;
    name: string;
  }[];
};

export type MobileReportSiteCoverageItem = {
  projectId: string;
  projectName: string;
  projectManagerName: string;
  siteId: string;
  siteName: string;
  reportsCount: number;
  latestReportAt: string | null;
  latestReportAuthorName: string | null;
  status: 'RECEIVED' | 'MISSING';
};

export type ReportValidationRequest = {
  reportId: string;
  coordinatorComment?: string;
};

export type ReportStatusUpdate = {
  status: ReportStatus;
  updatedAt: string;
};
