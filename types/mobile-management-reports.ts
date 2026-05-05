import type { ReportValidationStatus, Role } from '@prisma/client';

export type MobileManagementReportStatusFilter = 'ALL' | ReportValidationStatus;

export type MobileManagementReportProjectOption = {
  id: string;
  name: string;
};

export type MobileManagementReportSiteOption = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
};

export type MobileManagementReportItem = {
  id: string;
  projectId: string;
  projectName: string;
  siteId: string;
  siteName: string;
  authorId: string;
  authorName: string;
  authorRole: Role;
  submittedAt: string;
  validationStatus: ReportValidationStatus;
  excerpt: string;
};

export type MobileManagementReportsWidgets = {
  total: number;
  submitted: number;
  validated: number;
  sites: number;
};

export type MobileManagementReportsResponse = {
  generatedAt: string;
  widgets: MobileManagementReportsWidgets;
  projects: MobileManagementReportProjectOption[];
  sites: MobileManagementReportSiteOption[];
  reports: MobileManagementReportItem[];
};

export type MobileManagementReportDetailPhoto = {
  id: string;
  filename: string;
  url: string;
  takenAt: string;
};

export type MobileManagementReportDetailResponse = {
  generatedAt: string;
  report: MobileManagementReportItem & {
    content: string;
    session: {
      id: string;
      type: string;
      date: string;
      time: string;
      comment: string | null;
      distanceToSite: number;
    };
    validatedForClientAt: string | null;
    validatedForClientByName: string | null;
  };
  photos: MobileManagementReportDetailPhoto[];
};
