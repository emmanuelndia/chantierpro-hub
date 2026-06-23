import type { Role, SiteStatus, SiteType } from '@prisma/client';

export type SiteMapProjectOption = {
  id: string;
  name: string;
};

export type SiteMapProjectManagerOption = {
  id: string;
  name: string;
};

export type SiteMapSiteItem = {
  id: string;
  name: string;
  address: string;
  siteType: SiteType;
  status: SiteStatus;
  latitude: number;
  longitude: number;
  radiusKm: number;
  project: {
    id: string;
    name: string;
    city: string;
  };
  projectManager: {
    id: string;
    name: string;
  };
};

export type SiteMapResponse = {
  generatedAt: string;
  viewer: {
    role: Role;
    canLogVisit: boolean;
    canFilterProjectManager: boolean;
  };
  filters: {
    projects: SiteMapProjectOption[];
    projectManagers: SiteMapProjectManagerOption[];
  };
  totals: {
    sites: number;
    hiddenWithoutCoordinates: number;
  };
  sites: SiteMapSiteItem[];
};