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
  siteId: string;
  siteName: string;
};

export type SessionPhoto = {
  id: string;
  filename: string;
  url: string;
  takenAt: string;
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
  photoIds: string[];
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
