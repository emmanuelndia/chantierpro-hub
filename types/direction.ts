import type { ProjectStatus, Role } from '@prisma/client';

export type DirectionKpisResponse = {
  month: number;
  year: number;
  projects: {
    inProgress: number;
    completed: number;
    onHold: number;
  };
  presences: {
    currentMonth: number;
    previousMonth: number;
    deltaPercent: number | null;
  };
  photos: {
    currentMonth: number;
    previousMonth: number;
    deltaPercent: number | null;
  };
};

export type DirectionProjectManagerItem = {
  id: string;
  firstName: string;
  lastName: string;
};

export type DirectionConsolidatedProjectItem = {
  projectId: string;
  projectName: string;
  projectStatus: ProjectStatus;
  projectManager: DirectionProjectManagerItem;
  sitesCount: number;
  resourcesCount: number;
  hoursMonth: number;
  photosMonth: number;
  alertsCount: number;
};

export type DirectionConsolidatedProjectsResponse = {
  month: number;
  year: number;
  items: DirectionConsolidatedProjectItem[];
};

export type DirectionActiveSiteItem = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
};

export type DirectionActiveSitesResponse = {
  items: DirectionActiveSiteItem[];
};

export type DirectionSiteWithoutPresenceAlert = {
  siteId: string;
  siteName: string;
  projectId: string;
  projectName: string;
  lastPresenceAt: string | null;
};

export type DirectionIncompleteSessionAlert = {
  siteId: string;
  siteName: string;
  projectId: string;
  projectName: string;
  userId: string;
  firstName: string;
  lastName: string;
  role: Role;
  openedAt: string;
  hoursOpen: number;
};

export type DirectionAbsentResourceAlert = {
  siteId: string;
  siteName: string;
  projectId: string;
  projectName: string;
  userId: string;
  firstName: string;
  lastName: string;
  role: Role;
  lastPresenceAt: string | null;
  workingDaysAbsent: number;
};

export type DirectionAlertsResponse = {
  sitesWithoutPresence: DirectionSiteWithoutPresenceAlert[];
  incompleteSessions: DirectionIncompleteSessionAlert[];
  absentResources: DirectionAbsentResourceAlert[];
};

export type DirectionApiErrorCode = 'BAD_REQUEST' | 'FORBIDDEN';
