export type RhPresenceSummaryItem = {
  userId: string;
  firstName: string;
  lastName: string;
  email: string | null;
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
  arrivalRecordId: string;
  departureRecordId: string | null;
  date: string;
  siteId: string | null;
  siteName: string;
  arrivalTime: string;
  departureTime: string | null;
  realDurationHours: number | null;
  pauseDurationHours: number;
  distanceMeters: number;
  comment: string | null;
  status: 'COMPLETE' | 'INCOMPLETE_SESSION' | 'TO_REGULARIZE' | 'TO_REVIEW_RH';
  incomplete: boolean;
  isRemoteCheckout: boolean;
  isAutoClosed: boolean;
  isRegularized: boolean;
};

export type RhUserPresenceDetail = {
  userId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  month: number;
  year: number;
  sessions: RhPresenceSessionItem[];
};

export type RhExportInput = {
  format: 'csv' | 'xlsx' | 'pdf';
  from: string;
  to: string;
  userId: string | null;
  projectId: string | null;
  siteIds: string[];
  context: 'TERRAIN' | 'OFFICE' | null;
  lateOnly: boolean;
  attendanceList: boolean;
};

export type RhExportHistoryItem = {
  id: string;
  createdById: string;
  format: 'csv' | 'xlsx' | 'pdf';
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

export type RhResourceListItem = {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string | null;
  matricule: string | null;
  contact: string;
  role: string;
  resourceType: 'INTERNAL' | 'EXTERNAL';
  todayPresence: {
    label: string;
    context: 'TERRAIN' | 'OFFICE' | null;
    status: 'PRESENT' | 'PAUSED' | 'LEFT' | 'ABSENT' | 'NONE' | 'ANOMALY';
    arrivalAt: string | null;
    departureAt: string | null;
    isLate: boolean;
  };
};

export type RhResourcesResponse = {
  items: RhResourceListItem[];
  totalItems: number;
  missingMatricule: number;
  roles: string[];
};

export type RhSitePresenceLiveStatus =
  | 'PRESENT'
  | 'PAUSED'
  | 'EXPECTED_NOT_CLOCKED'
  | 'LEFT'
  | 'ANOMALY';

export type RhSitePresenceLiveResource = {
  userId: string;
  name: string;
  email: string | null;
  role: string;
  presenceContext: 'TERRAIN' | 'OFFICE';
  status: RhSitePresenceLiveStatus;
  taskAction: string | null;
  arrivalRecordId: string | null;
  arrivalAt: string | null;
  lastClockInAt: string | null;
  lastClockInType: string | null;
  distanceKm: number | null;
  arrivalGps: RhPresenceGpsPoint | null;
  departureGps: RhPresenceGpsPoint | null;
  isRemoteCheckout: boolean;
  isAutoClosed: boolean;
  isRegularized: boolean;
  anomalyReason: string | null;
  isLate: boolean;
  zoneActualName?: string | null;
  zoneSpecificPlace?: string | null;
  zoneComment?: string | null;
  outOfPlanningValidationStatus?: 'PENDING' | 'VALIDATED' | 'REFUSED' | null;
  outOfPlanningValidationLabel?: string | null;
  outOfPlanningTaskText?: string | null;
  outOfPlanningDecisionNote?: string | null;
};

export type RhPresenceGpsPoint = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  recordedAt: string;
};

export type RhSitePresenceLiveSite = {
  siteId: string | null;
  siteName: string;
  siteAddress: string;
  presenceContext: 'TERRAIN' | 'OFFICE';
  projectId: string;
  projectName: string;
  expectedCount: number;
  presentCount: number;
  pausedCount: number;
  notClockedCount: number;
  leftCount: number;
  anomalyCount: number;
  lastActivityAt: string | null;
  resources: RhSitePresenceLiveResource[];
};

export type RhSitePresenceLiveResponse = {
  generatedAt: string;
  date: string;
  summary: {
    activeSites: number;
    expectedResources: number;
    presentResources: number;
    pausedResources: number;
    notClockedResources: number;
    anomalies: number;
    lateResources: number;
  };
  options: {
    projects: RhFilterOption[];
    sites: (RhFilterOption & { projectId: string })[];
  resources: RhResourceOption[];
  projectManagers: RhFilterOption[];
  assigners: RhFilterOption[];
  roles: string[];
};
  sites: RhSitePresenceLiveSite[];
};

export type RhApiErrorCode =
  | 'BAD_REQUEST'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'EMPTY_EXPORT'
  | 'EXPORT_FAILED'
  | 'EXPORT_EXPIRED';
