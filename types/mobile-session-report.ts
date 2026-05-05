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
  targetProgress?: number;
  siteId: string;
  siteName: string;
};

export type SessionPhoto = {
  id: string;
  filename: string;
  url: string;
  takenAt: string;
  description?: string;
  thumbnail?: string;
};

export type SubmitReportRequest = {
  clockInRecordId: string;
  content: string;
  progressPercentage: number;
  blockageNote?: string;
  assignmentId?: string;
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
  assignment?: DayAssignment;
  photos: SessionPhoto[];
  hasExistingReport: boolean;
  existingReportId?: string;
};
