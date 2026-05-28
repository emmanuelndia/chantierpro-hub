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

export type GeneralSupervisorScopeItem = {
  id: string;
  generalSupervisorId: string;
  projectManagerId: string;
  siteId: string;
  startDate: string;
  endDate: string | null;
  status: GeneralSupervisorSiteScopeStatus;
  createdAt: string;
  generalSupervisor: GeneralSupervisorScopeUserOption;
  projectManager: GeneralSupervisorScopeUserOption;
  site: GeneralSupervisorScopeSiteOption;
};

export type GeneralSupervisorScopesResponse = {
  scopes: GeneralSupervisorScopeItem[];
  generalSupervisors: GeneralSupervisorScopeUserOption[];
  sites: GeneralSupervisorScopeSiteOption[];
};

export type CreateGeneralSupervisorScopeRequest = {
  generalSupervisorId: string;
  siteId: string;
  startDate: string;
  endDate?: string | null;
};

export type UpdateGeneralSupervisorScopeRequest = {
  startDate?: string;
  endDate?: string | null;
  status?: GeneralSupervisorSiteScopeStatus;
};
