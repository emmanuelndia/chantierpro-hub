import ExcelJS from 'exceljs';
import { PlanningWorkLocationType, ProjectStatus, Role, type PrismaClient } from '@prisma/client';
import {
  CLASSIC_FIELD_USER_ROLES,
  getBusinessManagedResourceRoles,
  isBusinessManagerRole,
} from '@/lib/field-roles';
import { createPlanningAssignment, operationalPlanningSiteWhere } from '@/lib/mobile-planning';
import type {
  PlanningImportCommitResponse,
  PlanningImportDetectedFormat,
  PlanningImportPreviewResponse,
  PlanningImportPreviewRow,
} from '@/types/planning-import';

type AuthLikeUser = {
  id: string;
  role: Role;
};

type ProjectOption = { id: string; name: string };
type ResourceOption = { id: string; name: string };
type SiteOption = { id: string; projectId: string; name: string; address: string };
type OfficeOption = { id: string; name: string; address: string };

type ImportContext = {
  projects: ProjectOption[];
  resources: ResourceOption[];
  sites: SiteOption[];
  offices: OfficeOption[];
};

const RESOURCE_HEADER_ALIASES = {
  date: ['date'],
  resource: ['nom de la ressource', 'ressource', 'superviseur'],
  project: ['nom du projet', 'projet/client', 'projet', 'client'],
  location: ['nom du site /adresse geographique', 'nom du site/adresse geographique', 'nom du site', 'site', 'adresse geographique', 'lieu', 'chantier_ou_zone_ou_bureau'],
  action: ['action du jour', 'activite du jour', 'action'],
  progress: ['progression en %', 'progression cible', 'progression_cible'],
  note: ['blocage ou remarque', 'observation', 'consigne'],
  type: ['type_tache'],
  quantity: ['objectif quantitatif', 'objectif_quantitatif'],
  unit: ['unite'],
  duration: ['duree prevue minutes', 'duree_prevue_minutes'],
} as const;

const MATRIX_HEADER_ALIASES = {
  locality: ['localite', 'zone_ou_localite'],
  task: ['tache', 'action'],
  unit: ['unite'],
  target: ['objectif', 'objectif_quantitatif'],
  durationDays: ['duree (j)', 'duree_prevue_jours'],
  note: ['consigne', 'remarque', 'observation'],
} as const;

export async function buildPlanningImportTemplate() {
  const workbook = new ExcelJS.Workbook();

  const resourceSheet = workbook.addWorksheet('planning_ressources');
  resourceSheet.columns = [
    { header: 'date', key: 'date', width: 14 },
    { header: 'ressource', key: 'resource', width: 28 },
    { header: 'projet', key: 'project', width: 28 },
    { header: 'type_tache', key: 'type', width: 18 },
    { header: 'chantier_ou_zone_ou_bureau', key: 'location', width: 28 },
    { header: 'action', key: 'action', width: 44 },
    { header: 'objectif_quantitatif', key: 'quantity', width: 18 },
    { header: 'unite', key: 'unit', width: 12 },
    { header: 'progression_cible', key: 'progress', width: 18 },
    { header: 'duree_prevue_minutes', key: 'duration', width: 20 },
    { header: 'consigne', key: 'note', width: 38 },
  ];
  resourceSheet.getRow(1).font = { bold: true };
  resourceSheet.addRow({
    date: '2026-06-24',
    resource: 'ADOBI ADOU EMMANUEL',
    project: 'FTTH MTN',
    type: 'Chantier',
    location: 'DUEKOUE',
    action: 'Correction et prises de puissances sur le T03',
    quantity: '',
    unit: '',
    progress: 45,
    duration: 120,
    note: '',
  });
  resourceSheet.addRow({
    date: '2026-06-24',
    resource: 'ZINGBE TILEY FLORE',
    project: 'FTTH MTN',
    type: 'Bureau',
    location: 'Bureau',
    action: 'Coordinatrice suivi des immeubles',
    quantity: '',
    unit: '',
    progress: 20,
    duration: 180,
    note: '',
  });

  const templateSheet = workbook.addWorksheet('planning_modeles');
  templateSheet.columns = [
    { header: 'projet', key: 'project', width: 28 },
    { header: 'zone_ou_localite', key: 'locality', width: 24 },
    { header: 'action', key: 'action', width: 36 },
    { header: 'objectif_quantitatif', key: 'target', width: 18 },
    { header: 'unite', key: 'unit', width: 12 },
    { header: 'duree_prevue_jours', key: 'durationDays', width: 18 },
    { header: 'consigne', key: 'note', width: 36 },
  ];
  templateSheet.getRow(1).font = { bold: true };
  templateSheet.addRow({
    project: 'CI ENERGIE OULOTO ZREBLI',
    locality: 'OULOTO ZREBLI',
    action: 'Tirage de cable BT',
    target: 4200,
    unit: 'm',
    durationDays: 3,
    note: '',
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function previewPlanningImport(
  prisma: PrismaClient,
  payload: { file: File; user: AuthLikeUser },
): Promise<PlanningImportPreviewResponse> {
  const context = await loadImportContext(prisma, payload.user);
  const rows = await parsePlanningImportFile(payload.file, context);
  return buildPreviewResponse(rows, context);
}

export async function commitPlanningImport(
  prisma: PrismaClient,
  payload: { user: AuthLikeUser; rows: PlanningImportPreviewRow[] },
): Promise<PlanningImportCommitResponse> {
  let createdAssignmentsCount = 0;
  let createdFreeMissionsCount = 0;
  let createdTemplatesCount = 0;
  let skippedCount = 0;

  for (const row of payload.rows) {
    if (!row.valid) {
      skippedCount += 1;
      continue;
    }

    if (row.kind === 'PROJECT_TEMPLATE_ROW') {
      const name = buildTemplateName(row.projectLabel, row.locality, row.action);
      const existing = await prisma.planningTaskTemplate.findFirst({
        where: {
          createdById: payload.user.id,
          name,
          action: row.action,
          workLocationType: row.suggestedWorkLocationType,
        },
        select: { id: true },
      });

      if (existing) {
        skippedCount += 1;
        continue;
      }

      await prisma.planningTaskTemplate.create({
        data: {
          name,
          action: row.action,
          targetQuantity: row.targetQuantity,
          targetUnit: row.targetUnit,
          objectiveText: buildTemplateObjectiveText(row),
          plannedDurationMinutes:
            row.plannedDurationDays === null ? null : Math.max(1, Math.round(row.plannedDurationDays * 8 * 60)),
          workLocationType: row.suggestedWorkLocationType,
          createdById: payload.user.id,
        },
      });
      createdTemplatesCount += 1;
      continue;
    }

    const createInput = {
      action: row.action,
      targetProgress: row.targetProgress,
      targetQuantity: null,
      targetUnit: null,
      date: row.date ?? new Date().toISOString().slice(0, 10),
      workLocationType: row.suggestedWorkLocationType ?? PlanningWorkLocationType.FREE_MISSION,
      objectiveText: row.note || null,
      plannedDurationMinutes: null,
      ...(row.resolvedResourceId ? { supervisorId: row.resolvedResourceId } : {}),
      ...(row.suggestedWorkLocationType === PlanningWorkLocationType.ON_SITE && row.resolvedSiteId
        ? { siteId: row.resolvedSiteId }
        : {}),
      ...(row.suggestedWorkLocationType === PlanningWorkLocationType.FREE_MISSION && row.resolvedProjectId
        ? { projectId: row.resolvedProjectId }
        : {}),
    };

    const result = await createPlanningAssignment(prisma, payload.user, createInput);

    if (result instanceof Response) {
      skippedCount += 1;
      continue;
    }

    if ('skipped' in result) {
      skippedCount += 1;
    } else if (('createdCount' in result && (result.createdCount ?? 0) > 0) || result.assignment) {
      if (row.suggestedWorkLocationType === PlanningWorkLocationType.FREE_MISSION) {
        createdFreeMissionsCount += 'createdCount' in result ? result.createdCount ?? 1 : 1;
      } else {
        createdAssignmentsCount += 'createdCount' in result ? result.createdCount ?? 1 : 1;
      }
      skippedCount += 'skippedCount' in result ? result.skippedCount ?? 0 : 0;
    } else {
      skippedCount += 1;
    }
  }

  const context = await loadImportContext(prisma, payload.user);
  return {
    ...buildPreviewResponse(payload.rows, context),
    createdAssignmentsCount,
    createdFreeMissionsCount,
    createdTemplatesCount,
    skippedCount,
  };
}

export function parsePlanningImportRowsPayload(value: unknown): PlanningImportPreviewRow[] | null {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    return null;
  }

  const rows = value.rows;
  if (!rows.every(isPlanningImportPreviewRow)) {
    return null;
  }
  return rows;
}

async function parsePlanningImportFile(file: File, context: ImportContext): Promise<PlanningImportPreviewRow[]> {
  const workbook = new ExcelJS.Workbook();
  const buffer = Buffer.from(await file.arrayBuffer());
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const detectedFormat = detectWorkbookFormat(workbook);
  if (!detectedFormat) {
    throw new Error('Format de planning non reconnu.');
  }

  return detectedFormat === 'RESOURCE_ROWS'
    ? parseResourceWorkbook(workbook, context)
    : parseProjectMatrixWorkbook(workbook, context);
}

async function loadImportContext(prisma: PrismaClient, user: AuthLikeUser): Promise<ImportContext> {
  const [projects, resources, sites, offices] = await Promise.all([
    prisma.project.findMany({
      where: getPlanningProjectWhere(user),
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: {
        role: { in: isBusinessManagerRole(user.role) ? [...getBusinessManagedResourceRoles(user.role)] : [...CLASSIC_FIELD_USER_ROLES] },
        isActive: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.site.findMany({
      where: operationalPlanningSiteWhere(user),
      orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        address: true,
        projectId: true,
      },
    }),
    prisma.officeLocation.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, address: true },
    }),
  ]);

  return {
    projects,
    resources: resources.map((item) => ({ id: item.id, name: `${item.firstName} ${item.lastName}`.trim() })),
    sites,
    offices,
  };
}

function detectWorkbookFormat(workbook: ExcelJS.Workbook): PlanningImportDetectedFormat | null {
  let sawResource = false;
  let sawMatrix = false;

  for (const worksheet of workbook.worksheets) {
    for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 20); rowNumber += 1) {
      const resourceMap = buildHeaderMap(worksheet.getRow(rowNumber), RESOURCE_HEADER_ALIASES);
      const matrixMap = buildHeaderMap(worksheet.getRow(rowNumber), MATRIX_HEADER_ALIASES);
      if (resourceMap.resource && resourceMap.action) {
        sawResource = true;
      }
      if (matrixMap.locality && matrixMap.task && matrixMap.target) {
        sawMatrix = true;
      }
    }
  }

  if (sawResource) return 'RESOURCE_ROWS';
  if (sawMatrix) return 'PROJECT_MATRIX';
  return null;
}

function parseResourceWorkbook(workbook: ExcelJS.Workbook, context: ImportContext): PlanningImportPreviewRow[] {
  const rows: PlanningImportPreviewRow[] = [];

  for (const worksheet of workbook.worksheets) {
    const headerRowIndex = findHeaderRowIndex(worksheet, 'resource');
    if (!headerRowIndex) continue;
    const headerMap = buildHeaderMap(worksheet.getRow(headerRowIndex), RESOURCE_HEADER_ALIASES);
    const sheetDate = detectSheetDate(worksheet);

    for (let rowNumber = headerRowIndex + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const resourceLabel = readCell(row, headerMap.resource);
      const action = readCell(row, headerMap.action);
      const projectLabel = readCell(row, headerMap.project);
      const locationLabel = readCell(row, headerMap.location);
      const note = readCell(row, headerMap.note);
      const typeLabel = readCell(row, headerMap.type);
      const explicitDate = parseDateValue(row.getCell(headerMap.date ?? 0).value);
      const progress = parseNullableNumber(readCell(row, headerMap.progress));

      if (!hasAnyValue([resourceLabel, action, projectLabel, locationLabel, note, typeLabel])) {
        continue;
      }

      const date = explicitDate ?? sheetDate;
      const resourceMatch = findUniqueMatch(resourceLabel, context.resources, (item) => item.name);
      const projectMatch = findUniqueMatch(projectLabel, context.projects, (item) => item.name);
      const siteMatch = findSiteMatch(locationLabel, projectMatch?.id ?? null, context.sites);
      const explicitType = parseWorkLocationTypeLabel(typeLabel);
      const officeMatch = findOfficeMatch(locationLabel, context.offices);
      const suggestedWorkLocationType =
        explicitType ??
        (officeMatch ? PlanningWorkLocationType.OFFICE : siteMatch ? PlanningWorkLocationType.ON_SITE : PlanningWorkLocationType.FREE_MISSION);

      const errors: string[] = [];
      if (!date) errors.push('Date introuvable.');
      if (!resourceLabel.trim()) errors.push('Ressource manquante.');
      if (!action.trim()) errors.push('Action manquante.');
      if (!projectMatch) errors.push('Projet introuvable ou ambigu.');
      if (!resourceMatch) errors.push('Ressource introuvable ou ambiguë.');
      if (suggestedWorkLocationType === PlanningWorkLocationType.ON_SITE && !siteMatch) {
        errors.push('Chantier introuvable ou ambigu.');
      }
      if (suggestedWorkLocationType === PlanningWorkLocationType.OFFICE && !siteMatch) {
        errors.push("Les tâches bureau importées doivent pour l'instant être rattachées à un chantier de contexte.");
      }
      if (suggestedWorkLocationType === PlanningWorkLocationType.FREE_MISSION && !projectMatch) {
        errors.push('Projet requis pour une zone.');
      }

      rows.push({
        id: `${worksheet.name}:${rowNumber}`,
        kind: 'RESOURCE_ROW',
        sheetName: worksheet.name,
        rowNumber,
        valid: errors.length === 0,
        errors,
        date,
        resourceLabel,
        action,
        projectLabel,
        locationLabel,
        note,
        targetProgress: progress,
        suggestedWorkLocationType,
        resolvedResourceId: resourceMatch?.id ?? null,
        resolvedProjectId: projectMatch?.id ?? null,
        resolvedSiteId: siteMatch?.id ?? null,
        resolvedOfficeLocationId: officeMatch?.id ?? null,
      });
    }
  }

  return rows;
}

function parseProjectMatrixWorkbook(workbook: ExcelJS.Workbook, context: ImportContext): PlanningImportPreviewRow[] {
  const rows: PlanningImportPreviewRow[] = [];

  for (const worksheet of workbook.worksheets) {
    const headerRowIndex = findHeaderRowIndex(worksheet, 'locality');
    if (!headerRowIndex) continue;
    const headerMap = buildHeaderMap(worksheet.getRow(headerRowIndex), MATRIX_HEADER_ALIASES);
    const projectText = collectTopText(worksheet);
    const projectMatch = findUniqueMatch(projectText, context.projects, (item) => item.name);

    for (let rowNumber = headerRowIndex + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const locality = readCell(row, headerMap.locality);
      const action = readCell(row, headerMap.task);
      const unit = readCell(row, headerMap.unit);
      const note = readCell(row, headerMap.note);
      const targetQuantity = parseNullableNumber(readCell(row, headerMap.target));
      const plannedDurationDays = parseNullableNumber(readCell(row, headerMap.durationDays));

      if (!hasAnyValue([locality, action, unit, note, String(targetQuantity ?? ''), String(plannedDurationDays ?? '')])) {
        continue;
      }

      const errors: string[] = [];
      if (!action.trim()) errors.push('Action manquante.');
      if (!locality.trim()) errors.push('Localité manquante.');
      if (!projectMatch) errors.push('Projet introuvable ou ambigu.');

      rows.push({
        id: `${worksheet.name}:${rowNumber}`,
        kind: 'PROJECT_TEMPLATE_ROW',
        sheetName: worksheet.name,
        rowNumber,
        valid: errors.length === 0,
        errors,
        projectLabel: projectText,
        resolvedProjectId: projectMatch?.id ?? null,
        locality,
        action,
        targetQuantity,
        targetUnit: unit || null,
        plannedDurationDays,
        note,
        suggestedWorkLocationType: PlanningWorkLocationType.ON_SITE,
      });
    }
  }

  return rows;
}

function buildPreviewResponse(rows: PlanningImportPreviewRow[], context: ImportContext): PlanningImportPreviewResponse {
  const detectedFormat = rows.some((row) => row.kind === 'RESOURCE_ROW') ? 'RESOURCE_ROWS' : 'PROJECT_MATRIX';
  return {
    detectedFormat,
    totalRows: rows.length,
    validRows: rows.filter((row) => row.valid).length,
    errorRows: rows.filter((row) => !row.valid).length,
    rows,
    resources: context.resources,
    projects: context.projects,
    sites: context.sites,
    offices: context.offices,
  };
}

function getPlanningProjectWhere(user: AuthLikeUser) {
  if (user.role === Role.PROJECT_MANAGER) {
    return {
      status: { notIn: [ProjectStatus.ARCHIVED, ProjectStatus.COMPLETED] },
      projectManagerId: user.id,
    };
  }

  if (user.role === Role.GENERAL_SUPERVISOR) {
    return {
      status: { notIn: [ProjectStatus.ARCHIVED, ProjectStatus.COMPLETED] },
      sites: { some: operationalPlanningSiteWhere(user) },
    };
  }

  return {
    status: { notIn: [ProjectStatus.ARCHIVED, ProjectStatus.COMPLETED] },
  };
}

function findHeaderRowIndex(worksheet: ExcelJS.Worksheet, mode: 'resource' | 'locality') {
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 20); rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (mode === 'resource') {
      const map = buildHeaderMap(row, RESOURCE_HEADER_ALIASES);
      if (map.resource && map.action) {
        return rowNumber;
      }
      continue;
    }

    const map = buildHeaderMap(row, MATRIX_HEADER_ALIASES);
    if (map.locality && map.task && map.target) {
      return rowNumber;
    }
  }
  return null;
}

function buildHeaderMap<T extends Record<string, readonly string[]>>(
  row: ExcelJS.Row,
  aliases: T,
): { [K in keyof T]: number | undefined } {
  const normalizedHeaders = new Map<number, string>();
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const value = normalizeMatchText(cellText(cell.value));
    if (value) {
      normalizedHeaders.set(colNumber, value);
    }
  });

  const map = {} as { [K in keyof T]: number | undefined };
  for (const [key, values] of Object.entries(aliases) as [keyof T, readonly string[]][]) {
    const match = [...normalizedHeaders.entries()].find(([, header]) => values.includes(header));
    map[key] = match?.[0];
  }
  return map;
}

function readCell(row: ExcelJS.Row, column: number | undefined) {
  if (!column) return '';
  return cellText(row.getCell(column).value).trim();
}

function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('result' in value && value.result !== undefined) return cellText(value.result);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text).join('');
    }
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function parseDateValue(value: ExcelJS.CellValue | undefined): string | null {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const text = cellText(value).trim();
  if (!text) return null;
  const slashMatch = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/.exec(text);
  if (slashMatch) {
    return `${slashMatch[3]!}-${slashMatch[2]!.padStart(2, '0')}-${slashMatch[1]!.padStart(2, '0')}`;
  }

  const isoDate = new Date(text);
  if (!Number.isNaN(isoDate.getTime())) {
    return isoDate.toISOString().slice(0, 10);
  }

  return null;
}

function detectSheetDate(worksheet: ExcelJS.Worksheet) {
  const candidates = [worksheet.name, collectTopText(worksheet)];
  for (const candidate of candidates) {
    const parsed = parseDateValue(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function collectTopText(worksheet: ExcelJS.Worksheet) {
  const values: string[] = [];
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 8); rowNumber += 1) {
    worksheet.getRow(rowNumber).eachCell({ includeEmpty: false }, (cell) => {
      const text = cellText(cell.value).trim();
      if (text) values.push(text);
    });
  }
  return values.join(' ');
}

function parseNullableNumber(value: string) {
  const normalized = value.replace(',', '.').replace(/\s+/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasAnyValue(values: string[]) {
  return values.some((value) => value.trim().length > 0);
}

function parseWorkLocationTypeLabel(value: string): PlanningWorkLocationType | null {
  const normalized = normalizeMatchText(value);
  if (!normalized) return null;
  if (normalized === 'chantier') return PlanningWorkLocationType.ON_SITE;
  if (normalized === 'bureau') return PlanningWorkLocationType.OFFICE;
  if (normalized === 'zone') return PlanningWorkLocationType.FREE_MISSION;
  return null;
}

function findUniqueMatch<T>(input: string, items: T[], getLabel: (item: T) => string): T | null {
  const key = normalizeMatchText(input);
  if (!key) return null;

  const exact = items.filter((item) => normalizeMatchText(getLabel(item)) === key);
  if (exact.length === 1) return exact[0]!;

  const partial = items.filter((item) => {
    const label = normalizeMatchText(getLabel(item));
    return label.includes(key) || key.includes(label);
  });
  if (partial.length === 1) return partial[0]!;

  const tokenMatches = items.filter((item) => {
    const labelTokens = new Set(normalizeMatchText(getLabel(item)).split(' ').filter(Boolean));
    return key
      .split(' ')
      .filter(Boolean)
      .every((token) => labelTokens.has(token));
  });
  return tokenMatches.length === 1 ? tokenMatches[0]! : null;
}

function findSiteMatch(locationLabel: string, projectId: string | null, sites: SiteOption[]) {
  const scopedSites = projectId ? sites.filter((site) => site.projectId === projectId) : sites;
  const exact = findUniqueMatch(locationLabel, scopedSites, (item) => item.name);
  if (exact) return exact;
  return findUniqueMatch(locationLabel, scopedSites, (item) => `${item.name} ${item.address}`);
}

function findOfficeMatch(locationLabel: string, offices: OfficeOption[]) {
  const key = normalizeMatchText(locationLabel);
  if (!key.includes('bureau')) {
    return null;
  }
  return findUniqueMatch(locationLabel, offices, (item) => item.name) ?? (offices.length === 1 ? offices[0]! : null);
}

function normalizeMatchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTemplateName(projectLabel: string, locality: string, action: string) {
  return [projectLabel, locality, action].filter(Boolean).join(' - ').slice(0, 120);
}

function buildTemplateObjectiveText(row: Extract<PlanningImportPreviewRow, { kind: 'PROJECT_TEMPLATE_ROW' }>) {
  const parts = [row.note.trim(), row.locality.trim() ? `Localité: ${row.locality.trim()}` : '', row.projectLabel.trim()];
  return parts.filter(Boolean).join(' | ') || null;
}

function isPlanningImportPreviewRow(value: unknown): value is PlanningImportPreviewRow {
  return isRecord(value) && typeof value.id === 'string' && typeof value.kind === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
