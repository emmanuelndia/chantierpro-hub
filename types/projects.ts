import type { ProjectStatus, Role, SiteStatus } from '@prisma/client';

export type ProjectListItem = {
  id: string;
  name: string;
  description: string;
  address: string;
  city: string;
  startDate: string;
  endDate: string | null;
  status: ProjectStatus;
  createdAt: string;
  projectManagerId: string;
  createdById: string;
  sitesCount: number;
  activeSitesCount: number;
  resourcesCount: number;
};

export type ProjectSiteItem = {
  id: string;
  projectId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  description: string;
  status: SiteStatus;
  area: number;
  startDate: string;
  endDate: string | null;
  siteManagerId: string;
  createdById: string;
  createdAt: string;
};

export type ProjectDetail = ProjectListItem & {
  sites: ProjectSiteItem[];
};

export type SiteDetail = ProjectSiteItem;

export type PaginatedProjectsResponse = {
  items: ProjectListItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type PresenceWorkerItem = {
  userId: string;
  firstName: string;
  lastName: string;
  role: Role;
};

export type ProjectPresenceSiteItem = {
  id: string;
  name: string;
  status: SiteStatus;
  presentCount: number;
  workers: PresenceWorkerItem[];
};

export type ProjectPresenceSummary = {
  projectId: string;
  date: string;
  totals: {
    activeSites: number;
    presentWorkers: number;
  };
  sites: ProjectPresenceSiteItem[];
};

export type ProjectFormUserOption = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  contact: string;
};

export type ProjectFormOptionsResponse = {
  projectManagers: ProjectFormUserOption[];
  siteManagers: ProjectFormUserOption[];
};

export type ProjectTeamSummaryItem = {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  contact: string;
  teamNames: string[];
  siteNames: string[];
  hoursThisMonth: number;
};

export type ProjectTeamSummaryResponse = {
  projectId: string;
  month: number;
  year: number;
  teamsCount: number;
  resourcesCount: number;
  items: ProjectTeamSummaryItem[];
};

export type ProjectPhotoItem = {
  id: string;
  siteId: string;
  siteName: string;
  uploadedByName: string;
  category: string;
  description: string;
  filename: string;
  url: string | null;
  createdAt: string;
};

export type ProjectPhotosResponse = {
  projectId: string;
  items: ProjectPhotoItem[];
};

export type TodaySiteItem = {
  id: string;
  projectId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  status: SiteStatus;
  hasOpenSession: boolean;
};

export type SitePresenceRowStatus = 'COMPLETE' | 'INCOMPLETE' | 'ANOMALY';

export type SitePresenceRow = {
  id: string;
  userId: string;
  resourceName: string;
  date: string;
  arrivalTime: string | null;
  departureTime: string | null;
  pauseDurationMinutes: number;
  realDurationMinutes: number | null;
  distanceMeters: number;
  status: SitePresenceRowStatus;
  comment: string | null;
  types: string[];
};

export type PaginatedSitePresencesResponse = {
  siteId: string;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  items: SitePresenceRow[];
};

export type GeocodingSuggestion = {
  label: string;
  latitude: number;
  longitude: number;
};

export type GeocodingSearchResponse = {
  items: GeocodingSuggestion[];
};

export type CreateProjectInput = {
  name: string;
  description: string;
  address: string;
  city: string;
  startDate: string;
  endDate: string | null;
  projectManagerId: string;
  status: ProjectStatus;
};

export type UpdateProjectInput = CreateProjectInput;

export type CreateSiteInput = {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  radiusKmProvided: boolean;
  description: string;
  status: SiteStatus;
  area: number;
  startDate: string;
  endDate: string | null;
  siteManagerId: string;
};

export type UpdateSiteInput = CreateSiteInput;

export type ProjectApiErrorCode =
  | 'BAD_REQUEST'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PROJECT_HAS_ACTIVE_SITES'
  | 'PROJECT_CLOSED'
  | 'INVALID_PROJECT_MANAGER'
  | 'INVALID_SITE_MANAGER'
  | 'INVALID_RADIUS'
  | 'INVALID_DATE_RANGE'
  | 'INVALID_NAME'
  | 'INVALID_ROLE'
  | 'TECHNICIAN_ONLY'
  | 'GEOFENCING_FORBIDDEN';
