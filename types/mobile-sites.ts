import type { SiteStatus } from '@prisma/client';
import type { ProjectFormUserOption, SiteDetail } from '@/types/projects';

export type MobileSiteStatusFilter = 'ALL' | SiteStatus;

export type MobileSiteManagementProjectOption = {
  id: string;
  name: string;
};

export type MobileSiteManagementItem = {
  id: string;
  projectId: string;
  name: string;
  address: string;
  status: SiteStatus;
  latitude: number;
  longitude: number;
  radiusKm: number;
  startDate: string;
  endDate: string | null;
  project: MobileSiteManagementProjectOption;
  teamsCount: number;
  resourcesCount: number;
  photosCount: number;
  clockInRecordsCount: number;
};

export type MobileSitesManagementWidgets = {
  total: number;
  active: number;
  onHold: number;
  completed: number;
};

export type MobileSitesManagementResponse = {
  generatedAt: string;
  widgets: MobileSitesManagementWidgets;
  projects: MobileSiteManagementProjectOption[];
  sites: MobileSiteManagementItem[];
};

export type MobileSiteFormOptionsResponse = {
  projects: MobileSiteManagementProjectOption[];
  siteManagers: ProjectFormUserOption[];
};

export type MobileSiteFormResponse = {
  site: SiteDetail;
  options: MobileSiteFormOptionsResponse;
};
