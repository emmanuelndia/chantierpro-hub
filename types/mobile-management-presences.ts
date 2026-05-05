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
