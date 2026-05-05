import type { ClockInType, ReportValidationStatus, Role } from '@prisma/client';

export type GeneralSupervisorReportStatusFilter = 'ALL' | ReportValidationStatus;

export type GeneralSupervisorReportSiteOption = {
  id: string;
  name: string;
};

export type GeneralSupervisorReportSupervisorOption = {
  id: string;
  firstName: string;
  lastName: string;
  role: Role;
};

export type GeneralSupervisorReportItem = {
  id: string;
  siteId: string;
  siteName: string;
  authorId: string;
  authorName: string;
  authorRole: Role;
  submittedAt: string;
  validationStatus: ReportValidationStatus;
  excerpt: string;
};

export type GeneralSupervisorMissingReportItem = {
  id: string;
  siteId: string;
  siteName: string;
  supervisorId: string;
  supervisorName: string;
  departureAt: string;
};

export type GeneralSupervisorReportsSummary = {
  received: number;
  expected: number;
  missing: number;
  sites: number;
};

export type GeneralSupervisorReportsResponse = {
  generatedAt: string;
  date: string;
  summary: GeneralSupervisorReportsSummary;
  sites: GeneralSupervisorReportSiteOption[];
  supervisors: GeneralSupervisorReportSupervisorOption[];
  reports: GeneralSupervisorReportItem[];
  missingReports: GeneralSupervisorMissingReportItem[];
};

export type GeneralSupervisorReportDetailPhoto = {
  id: string;
  filename: string;
  url: string;
  takenAt: string;
};

export type GeneralSupervisorReportDetailResponse = {
  generatedAt: string;
  report: GeneralSupervisorReportItem & {
    content: string;
    session: {
      id: string;
      type: ClockInType;
      date: string;
      time: string;
      comment: string | null;
      distanceToSite: number;
    };
    validatedForClientAt: string | null;
    validatedForClientByName: string | null;
  };
  photos: GeneralSupervisorReportDetailPhoto[];
};
