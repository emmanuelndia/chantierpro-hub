import type { ReportStatus, ReportValidationStatus, Role } from '@prisma/client';

export type CreateReportInput = {
  content: string;
  clockInRecordId: string;
};

export type ReportItem = {
  id: string;
  siteId: string;
  siteName: string;
  projectId: string;
  projectName: string;
  userId: string;
  content: string;
  progression: number | null;
  blocage: string | null;
  status: ReportStatus;
  validationStatus: ReportValidationStatus;
  validatedForClientAt: string | null;
  validatedForClientBy: {
    id: string;
    firstName: string;
    lastName: string;
    role: Role;
  } | null;
  submittedAt: string;
  createdAt: string;
  author: {
    id: string;
    firstName: string;
    lastName: string;
    role: Role;
  };
  session: {
    id: string;
    type: string;
    date: string;
    time: string;
    comment: string | null;
    distanceToSite: number;
  };
};

export type ReportDetailPhoto = {
  id: string;
  filename: string;
  url: string;
  takenAt: string;
};

export type ReportDetail = ReportItem & {
  photos: ReportDetailPhoto[];
};

export type PaginatedReportsResponse = {
  items: ReportItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type NearbySiteItem = {
  id: string;
  name: string;
  address: string;
  distance: number;
  radiusKm: number;
};

export type WebReportStatusFilter = 'ALL' | ReportStatus;
export type WebReportValidationFilter = 'ALL' | ReportValidationStatus;

export type WebReportOption = {
  id: string;
  name: string;
};

export type WebReportSiteOption = WebReportOption & {
  projectId: string;
  projectName: string;
};

export type WebReportResourceOption = WebReportOption & {
  role: Role;
};

export type WebReportItem = {
  id: string;
  projectId: string;
  projectName: string;
  siteId: string;
  siteName: string;
  authorId: string;
  authorName: string;
  authorRole: Role;
  submittedAt: string;
  progression: number | null;
  blocage: string | null;
  status: ReportStatus;
  validationStatus: ReportValidationStatus;
  excerpt: string;
};

export type WebReportsResponse = {
  generatedAt: string;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  widgets: {
    total: number;
    submitted: number;
    validated: number;
    sites: number;
  };
  options: {
    projects: WebReportOption[];
    sites: WebReportSiteOption[];
    resources: WebReportResourceOption[];
  };
  items: WebReportItem[];
};

export type ReportApiErrorCode =
  | 'BAD_REQUEST'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'EMPTY_CONTENT'
  | 'ALREADY_VALIDATED'
  | 'EXPORT_FAILED';
