import type { PlanningWorkLocationType } from '@prisma/client';

export type PlanningImportDetectedFormat = 'RESOURCE_ROWS' | 'PROJECT_MATRIX';

export type PlanningImportProjectOption = {
  id: string;
  name: string;
};

export type PlanningImportResourceOption = {
  id: string;
  name: string;
};

export type PlanningImportSiteOption = {
  id: string;
  projectId: string;
  name: string;
  address: string;
};

export type PlanningImportOfficeOption = {
  id: string;
  name: string;
  address: string;
};

export type PlanningImportBaseRow = {
  id: string;
  sheetName: string;
  rowNumber: number;
  valid: boolean;
  errors: string[];
};

export type PlanningImportResourceRow = PlanningImportBaseRow & {
  kind: 'RESOURCE_ROW';
  date: string | null;
  resourceLabel: string;
  action: string;
  projectLabel: string;
  locationLabel: string;
  note: string;
  targetProgress: number | null;
  suggestedWorkLocationType: PlanningWorkLocationType | null;
  resolvedResourceId: string | null;
  resolvedProjectId: string | null;
  resolvedSiteId: string | null;
  resolvedOfficeLocationId: string | null;
};

export type PlanningImportTemplateRow = PlanningImportBaseRow & {
  kind: 'PROJECT_TEMPLATE_ROW';
  projectLabel: string;
  resolvedProjectId: string | null;
  locality: string;
  action: string;
  targetQuantity: number | null;
  targetUnit: string | null;
  plannedDurationDays: number | null;
  note: string;
  suggestedWorkLocationType: PlanningWorkLocationType;
};

export type PlanningImportPreviewRow = PlanningImportResourceRow | PlanningImportTemplateRow;

export type PlanningImportPreviewResponse = {
  detectedFormat: PlanningImportDetectedFormat;
  totalRows: number;
  validRows: number;
  errorRows: number;
  rows: PlanningImportPreviewRow[];
  resources: PlanningImportResourceOption[];
  projects: PlanningImportProjectOption[];
  sites: PlanningImportSiteOption[];
  offices: PlanningImportOfficeOption[];
};

export type PlanningImportCommitResponse = PlanningImportPreviewResponse & {
  createdAssignmentsCount: number;
  createdFreeMissionsCount: number;
  createdTemplatesCount: number;
  skippedCount: number;
};
