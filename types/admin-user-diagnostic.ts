import type { Role } from '@prisma/client';

export type AdminUserDiagnosticSeverity = 'info' | 'warning' | 'error';

export type AdminUserDiagnosticItem = {
  severity: AdminUserDiagnosticSeverity;
  code: string;
  message: string;
  hint: string | null;
};

export type AdminUserDiagnosticAssignment = {
  id: string;
  kind: 'SITE' | 'ZONE' | 'OFFICE' | 'NEGOTIATION';
  label: string;
  projectName: string | null;
  siteName: string | null;
  zoneName: string | null;
  action: string;
  status: string;
  source: 'PLANNING' | 'FREE_MISSION' | 'NEGOTIATION';
};

export type AdminUserDiagnosticSiteOption = {
  id: string;
  name: string;
  projectName: string | null;
  source: 'PLANNING' | 'OPEN_SESSION' | 'ROLE_ACCESS';
};

export type AdminUserDiagnosticResponse = {
  date: string;
  user: {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
    email: string | null;
    matricule: string | null;
    role: Role;
    isActive: boolean;
    lastLoginAt: string | null;
    scopeSummary: string[];
  };
  mobileVisibility: {
    canUseClockIn: boolean;
    canUseOffice: boolean;
    canUseSite: boolean;
    canUseZone: boolean;
    canUseProfessionalTravel: boolean;
    canUploadPhotos: boolean;
  };
  assignments: {
    all: AdminUserDiagnosticAssignment[];
    site: AdminUserDiagnosticAssignment[];
    zone: AdminUserDiagnosticAssignment[];
    office: AdminUserDiagnosticAssignment[];
    negotiation: AdminUserDiagnosticAssignment[];
  };
  clockIn: {
    recordsCount: number;
    hasOpenSession: boolean;
    openSessionLabel: string | null;
    pauseActive: boolean;
    lastEventLabel: string | null;
  };
  photo: {
    sites: AdminUserDiagnosticSiteOption[];
  };
  offline: {
    preparedByMobileOnly: boolean;
    expectedCacheKeys: string[];
  };
  simulatedView: {
    office: { available: boolean; reason: string | null };
    site: { available: boolean; options: AdminUserDiagnosticSiteOption[]; reason: string | null };
    zone: { available: boolean; options: AdminUserDiagnosticAssignment[]; reason: string | null };
    professionalTravel: { available: boolean; reason: string | null };
  };
  diagnostics: AdminUserDiagnosticItem[];
};
