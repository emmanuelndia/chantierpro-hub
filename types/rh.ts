export type RhPresenceSummaryItem = {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  nbDays: number;
  totalHours: number;
  nbSessions: number;
  avgHoursPerDay: number;
  lastSite: string | null;
  incompleteSessions: number;
  totalPauseDuration: number;
  sitesCount: number;
};

export type RhPresencesResponse = {
  month: number;
  year: number;
  summary: {
    totalHours: number;
    activeResources: number;
    sitesCount: number;
    incompleteSessions: number;
  };
  items: RhPresenceSummaryItem[];
};

export type RhPresenceSessionItem = {
  date: string;
  siteId: string;
  siteName: string;
  arrivalTime: string;
  departureTime: string | null;
  realDurationHours: number | null;
  pauseDurationHours: number;
  distanceMeters: number;
  comment: string | null;
  status: 'VALID' | 'INCOMPLETE_SESSION';
  incomplete: boolean;
};

export type RhUserPresenceDetail = {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  month: number;
  year: number;
  sessions: RhPresenceSessionItem[];
};

export type RhExportInput = {
  format: 'csv' | 'xlsx';
  from: string;
  to: string;
  userId: string | null;
  projectId: string | null;
  siteIds: string[];
};

export type RhExportHistoryItem = {
  id: string;
  createdById: string;
  format: 'csv' | 'xlsx';
  from: string;
  to: string;
  userId: string | null;
  projectId: string | null;
  rowCount: number;
  fileName: string | null;
  contentType: string | null;
  expiresAt: string | null;
  isAvailable: boolean;
  downloadUrl: string | null;
  createdAt: string;
  createdBy: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
  };
};

export type RhExportHistoryResponse = {
  items: RhExportHistoryItem[];
};

export type RhFilterOption = {
  id: string;
  label: string;
};

export type RhResourceOption = {
  id: string;
  label: string;
  role: string;
};

export type RhOptionsResponse = {
  projects: RhFilterOption[];
  sites: (RhFilterOption & { projectId: string })[];
  resources: RhResourceOption[];
};

export type RhApiErrorCode =
  | 'BAD_REQUEST'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'EMPTY_EXPORT'
  | 'EXPORT_FAILED'
  | 'EXPORT_EXPIRED';
