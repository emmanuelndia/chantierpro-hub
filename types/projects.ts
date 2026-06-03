import type { ProjectStatus, Role, SiteGeofenceType, SiteStatus, SiteType } from '@prisma/client';

export type SiteGeofencePolygon = {
  type: 'Polygon';
  coordinates: [number, number][][];
};

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
  siteType: SiteType;
  requiresClockIn: boolean;
  latitude: number;
  longitude: number;
  radiusKm: number;
  geofenceType: SiteGeofenceType;
  geofencePolygon: SiteGeofencePolygon | null;
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
  email: string | null;
  role: Role;
  contact: string;
};

export type ProjectFormOptionsResponse = {
  projects: Pick<ProjectListItem, 'id' | 'name' | 'status'>[];
  projectManagers: ProjectFormUserOption[];
  siteManagers: ProjectFormUserOption[];
};

export type ProjectTeamSummaryItem = {
  userId: string;
  firstName: string;
  lastName: string;
  email: string | null;
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
  siteId: string | null;
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
  siteType: SiteType;
  requiresClockIn: boolean;
  latitude: number;
  longitude: number;
  radiusKm: number;
  geofenceType: SiteGeofenceType;
  geofencePolygon: SiteGeofencePolygon | null;
  status: SiteStatus;
  hasOpenSession: boolean;
  assignmentIds?: string[];
  source?: 'PLANNING' | 'OPEN_SESSION';
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
  error?: 'MAPBOX_UNAVAILABLE' | 'MAPBOX_TOKEN_MISSING';
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

export type UpdateProjectInput = Partial<CreateProjectInput>;

export type CreateSiteInput = {
  name: string;
  address: string;
  siteType: SiteType;
  requiresClockIn: boolean;
  latitude: number;
  longitude: number;
  radiusKm: number;
  radiusKmProvided: boolean;
  geofenceType: SiteGeofenceType;
  geofencePolygon: SiteGeofencePolygon | null;
  description: string;
  status: SiteStatus;
  area: number;
  startDate: string;
  endDate: string | null;
  siteManagerId: string;
};

export type UpdateSiteInput = Partial<Omit<CreateSiteInput, 'radiusKm' | 'radiusKmProvided'>> & {
  projectId?: string;
  radiusKm?: number;
  radiusKmProvided: boolean;
};

export type SiteImportColumnKey =
  | 'nom'
  | 'adresse_ou_repere'
  | 'latitude'
  | 'longitude'
  | 'rayon_km'
  | 'surface'
  | 'date_debut'
  | 'date_fin'
  | 'responsable_gs_email'
  | 'statut'
  | 'description';

export type SiteImportFieldError = {
  field: SiteImportColumnKey | 'row';
  message: string;
};

export type SiteImportWarning = {
  field: SiteImportColumnKey | 'row';
  message: string;
};

export type SiteImportNormalizedRow = {
  rowNumber: number;
  nom: string;
  adresse_ou_repere: string;
  latitude: string;
  longitude: string;
  rayon_km: string;
  surface: string;
  date_debut: string;
  date_fin: string;
  responsable_gs_email: string;
  statut: string;
  description: string;
};

export type SiteImportPreviewRow = {
  rowNumber: number;
  normalized: SiteImportNormalizedRow;
  errors: SiteImportFieldError[];
  warnings: SiteImportWarning[];
  valid: boolean;
};

export type SiteImportPreviewResponse = {
  projectId: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  warningRows: number;
  rows: SiteImportPreviewRow[];
};

export type SiteImportCommitResponse = {
  projectId: string;
  createdCount: number;
  skippedCount: number;
  rows: SiteImportPreviewRow[];
};

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
