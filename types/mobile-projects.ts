import type { ProjectStatus, ReportValidationStatus, Role, SiteStatus } from '@prisma/client';

export type MobileProjectStatusFilter = 'ALL' | ProjectStatus;

export type MobileProjectWidget = {
  id: 'total' | 'active' | 'completed' | 'alerts';
  label: string;
  value: number;
  helper: string;
};

export type MobileProjectListItem = {
  id: string;
  name: string;
  description: string;
  address: string;
  city: string;
  status: ProjectStatus;
  startDate: string;
  endDate: string | null;
  createdAt: string;
  projectManagerId: string;
  projectManagerName: string;
  sitesCount: number;
  activeSitesCount: number;
  completedSitesCount: number;
  teamsCount: number;
  photosCount: number;
  reportsCount: number;
  progressPercent: number;
  hasAlert: boolean;
};

export type MobileProjectsResponse = {
  generatedAt: string;
  widgets: MobileProjectWidget[];
  projects: MobileProjectListItem[];
};

export type MobileProjectDetailKpis = {
  activeSites: number;
  resources: number;
  photos: number;
  reports: number;
};

export type MobileProjectDetailSite = {
  id: string;
  name: string;
  address: string;
  status: SiteStatus;
  startDate: string;
  endDate: string | null;
  teamsCount: number;
  resourcesCount: number;
  photosCount: number;
  reportsCount: number;
};

export type MobileProjectDetailTeam = {
  id: string;
  name: string;
  siteId: string;
  siteName: string;
  teamLeadName: string;
  membersCount: number;
  members: {
    id: string;
    name: string;
    role: Role;
  }[];
};

export type MobileProjectDetailPhoto = {
  id: string;
  siteId: string;
  siteName: string;
  filename: string;
  url: string;
  uploadedByName: string;
  createdAt: string;
};

export type MobileProjectDetailReport = {
  id: string;
  siteId: string;
  siteName: string;
  authorName: string;
  submittedAt: string;
  validationStatus: ReportValidationStatus;
  content: string;
};

export type MobileProjectDetailResponse = {
  generatedAt: string;
  project: MobileProjectListItem;
  kpis: MobileProjectDetailKpis;
  sites: MobileProjectDetailSite[];
  teams: MobileProjectDetailTeam[];
  photos: MobileProjectDetailPhoto[];
  reports: MobileProjectDetailReport[];
};
