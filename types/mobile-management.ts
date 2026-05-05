import type { SiteStatus } from '@prisma/client';

export type MobileManagementDashboardWidget = {
  id: 'present' | 'resources' | 'sites' | 'alerts';
  label: string;
  value: number;
  helper: string;
};

export type MobileManagementSiteItem = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  status: SiteStatus;
  presentCount: number;
  totalResources: number;
  lastClockInAt: string | null;
};

export type MobileManagementAlertItem = {
  id: string;
  type: 'NO_PRESENCE_2D' | 'INCOMPLETE_SESSION_12H';
  siteId: string;
  siteName: string;
  projectName: string;
  title: string;
  description: string;
  occurredAt: string | null;
};

export type MobileManagementPhotoItem = {
  id: string;
  siteId: string;
  siteName: string;
  filename: string;
  createdAt: string;
  url: string | null;
};

export type MobileManagementDashboardResponse = {
  generatedAt: string;
  widgets: MobileManagementDashboardWidget[];
  sites: MobileManagementSiteItem[];
  alerts: MobileManagementAlertItem[];
  latestPhotos: MobileManagementPhotoItem[];
};
