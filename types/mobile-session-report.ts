import type { PhotoTag } from '@prisma/client';

export type SessionSummary = {
  id: string;
  siteId: string;
  siteName: string;
  siteAddress: string;
  date: string;
  arrivalAt: string;
  departureAt: string;
  durationSeconds: number;
  pauseDurationSeconds: number;
  effectiveDurationSeconds: number;
  photoCount: number;
  clockInRecordId: string;
};

export type DayAssignment = {
  id: string;
  action: string;
  targetProgress?: number | undefined;
  targetQuantity?: number | undefined;
  targetUnit?: string | undefined;
  objectiveText?: string | undefined;
  actualQuantity?: number | null | undefined;
  actualProgress?: number | null | undefined;
  remainingQuantity?: number | null | undefined;
  progressDelta?: number | null | undefined;
  objectiveStatus?: string | undefined;
  latestProgressComment?: string | null | undefined;
  latestProgressBlocked?: boolean | undefined;
  siteId: string;
  siteName: string;
};

export type SessionPhoto = {
  id: string;
  filename: string;
  url: string;
  takenAt: string;
  tags: PhotoTag[];
  planningAssignmentId: string | null;
  assignmentAction?: string | undefined;
  assignmentStatus?: string | undefined;
  description?: string | undefined;
  thumbnail?: string | undefined;
};

export type SubmitReportRequest = {
  clockInRecordId: string;
  content: string;
  progressPercentage: number;
  blockageNote?: string | undefined;
  assignmentId?: string | undefined;
  photoIds?: string[] | undefined;
};

export type ReportSubmissionResponse = {
  success: boolean;
  reportId: string;
  message: string;
  isOffline: boolean;
};

export type SessionReportData = {
  session: SessionSummary;
  assignment?: DayAssignment | undefined;
  photos: SessionPhoto[];
  hasExistingReport: boolean;
  existingReportId?: string | undefined;
};

export type PendingSessionReportItem = {
  departureRecordId: string;
  siteId: string;
  siteName: string;
  date: string;
  endedAt: string;
};

export type PendingSessionReportsResponse = {
  total: number;
  items: PendingSessionReportItem[];
};
