import type { GeneralSupervisorSiteScopeStatus } from '@prisma/client';

export type GeneralSupervisorScopeUserOption = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
};

export type GeneralSupervisorScopeSiteOption = {
  id: string;
  name: string;
  address: string;
  project: {
    id: string;
    name: string;
  };
};

export type GeneralSupervisorScopeProjectOption = {
  id: string;
  name: string;
};

type GeneralSupervisorScopeBaseItem = {
  id: string;
  generalSupervisorId: string;
  projectManagerId: string;
  startDate: string;
  endDate: string | null;
  status: GeneralSupervisorSiteScopeStatus;
  createdAt: string;
  generalSupervisor: GeneralSupervisorScopeUserOption;
  projectManager: GeneralSupervisorScopeUserOption;
};

export type GeneralSupervisorSiteScopeItem = GeneralSupervisorScopeBaseItem & {
  scopeType: 'SITES';
  siteId: string;
  site: GeneralSupervisorScopeSiteOption;
  project: GeneralSupervisorScopeProjectOption;
};

export type GeneralSupervisorProjectScopeItem = GeneralSupervisorScopeBaseItem & {
  scopeType: 'PROJECT';
  projectId: string;
  project: GeneralSupervisorScopeProjectOption;
  site: null;
};

export type GeneralSupervisorScopeItem = GeneralSupervisorSiteScopeItem | GeneralSupervisorProjectScopeItem;

export type GeneralSupervisorScopesResponse = {
  scopes: GeneralSupervisorScopeItem[];
  siteScopes: GeneralSupervisorSiteScopeItem[];
  projectScopes: GeneralSupervisorProjectScopeItem[];
  generalSupervisors: GeneralSupervisorScopeUserOption[];
  projects: GeneralSupervisorScopeProjectOption[];
  sites: GeneralSupervisorScopeSiteOption[];
};

export type CreateGeneralSupervisorScopeRequest = {
  generalSupervisorId: string;
  scopeType?: 'PROJECT' | 'SITES';
  projectId?: string;
  siteId?: string;
  siteIds?: string[];
  startDate: string;
  endDate?: string | null;
};

export type UpdateGeneralSupervisorScopeRequest = {
  startDate?: string;
  endDate?: string | null;
  status?: GeneralSupervisorSiteScopeStatus;
};
