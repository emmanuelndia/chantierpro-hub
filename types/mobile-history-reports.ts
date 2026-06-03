import type { PhotoTag } from '@prisma/client';

export type ReportStatus = 'RECU' | 'EN_REVUE' | 'VALIDE' | 'ENVOYE';

export type ReportSummary = {
  id: string;
  siteId: string | null;
  siteName: string;
  date: string;
  progressPercentage: number;
  content: string;
  status: ReportStatus;
  photoCount: number;
  coordinatorComment?: string;
  blockageNote?: string;
  createdAt: string;
  updatedAt: string;
};

export type ReportDetail = ReportSummary & {
  photos: {
    id: string;
    filename: string;
    url: string;
    thumbnail?: string;
    takenAt: string;
    tags: PhotoTag[];
    planningAssignmentId: string | null;
    assignmentAction?: string;
    description?: string;
  }[];
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
