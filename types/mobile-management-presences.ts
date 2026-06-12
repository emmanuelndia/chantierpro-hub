import type { Role, SiteStatus } from '@prisma/client';

export type MobileManagementPresenceStatus = 'PRESENT' | 'PAUSED' | 'ABSENT';

export type MobileManagementPresencesWidget = {
  id: 'present' | 'paused' | 'absent' | 'activeSites';
  label: string;
  value: number;
  helper: string;
};

export type MobileManagementPresencesProject = {
  id: string;
  name: string;
};

export type MobileManagementPresenceResource = {
  userId: string;
  name: string;
  role: Role;
  status: MobileManagementPresenceStatus;
  presentSince: string | null;
  pauseSince: string | null;
  lastClockInAt: string | null;
};

export type MobileManagementPresenceSite = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  status: SiteStatus;
  presentCount: number;
  pausedCount: number;
  absentCount: number;
  totalResources: number;
  lastClockInAt: string | null;
  resources: MobileManagementPresenceResource[];
};

export type MobileManagementPresencesResponse = {
  generatedAt: string;
  widgets: MobileManagementPresencesWidget[];
  projects: MobileManagementPresencesProject[];
  sites: MobileManagementPresenceSite[];
};

export type MobilePresenceListStatus =
  | 'PRESENT'
  | 'PAUSED'
  | 'LEFT'
  | 'ABSENT'
  | 'ANOMALY';

export type MobilePresenceListContext = 'OFFICE' | 'TERRAIN';

export type MobilePresenceListResource = {
  userId: string;
  name: string;
  role: string;
  presenceContext: MobilePresenceListContext;
  contextLabel: string;
  status: MobilePresenceListStatus;
  arrivalAt: string | null;
  departureAt: string | null;
  durationSeconds: number | null;
  isLate: boolean;
  positionLabel: string;
  detailsCount: number;
};

export type MobilePresenceListResponse = {
  generatedAt: string;
  date: string;
  summary: {
    total: number;
    present: number;
    office: number;
    terrain: number;
    absent: number;
    late: number;
    anomalies: number;
  };
  options: {
    projects: { id: string; label: string }[];
    sites: { id: string; label: string; projectId: string }[];
  };
  resources: MobilePresenceListResource[];
};
