import ExcelJS from 'exceljs';
import { Prisma, SiteStatus, type PrismaClient, type Role } from '@prisma/client';
import {
  assertCreateSiteRadiusAllowed,
  parseCreateSiteInput,
  SITE_ADDRESS_NOT_PROVIDED,
  validateDateRange,
  validateRadius,
  validateSiteManager,
} from '@/lib/projects';
import type {
  CreateSiteInput,
  ProjectApiErrorCode,
  SiteImportColumnKey,
  SiteImportCommitResponse,
  SiteImportFieldError,
  SiteImportNormalizedRow,
  SiteImportPreviewResponse,
  SiteImportPreviewRow,
  SiteImportWarning,
} from '@/types/projects';

export const SITE_IMPORT_COLUMNS: { key: SiteImportColumnKey; label: string; required: boolean }[] = [
  { key: 'nom', label: 'nom', required: true },
  { key: 'adresse_ou_repere', label: 'adresse_ou_repere', required: false },
  { key: 'latitude', label: 'latitude', required: true },
  { key: 'longitude', label: 'longitude', required: true },
  { key: 'rayon_km', label: 'rayon_km', required: false },
  { key: 'surface', label: 'surface_estimee', required: false },
  { key: 'date_debut', label: 'date_debut', required: true },
  { key: 'date_fin', label: 'date_fin', required: false },
  { key: 'responsable_gs_email', label: 'responsable_gs_identifiant', required: true },
  { key: 'statut', label: 'statut', required: false },
  { key: 'description', label: 'description', required: false },
];

const CLOSE_COORDINATE_THRESHOLD_KM = 0.03;

type AuthLikeUser = {
  id: string;
  role: Role;
};

type SiteImportValidation = {
  row: SiteImportPreviewRow;
  input: CreateSiteInput | null;
};

type ExistingSite = {
  id: string;
  name: string;
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
};

export async function buildSiteImportTemplate() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('chantiers');
  worksheet.columns = SITE_IMPORT_COLUMNS.map((column) => ({
    header: column.label,
    key: column.key,
    width: Math.max(18, column.label.length + 4),
  }));
  worksheet.getRow(1).font = { bold: true };
  worksheet.addRow({
    nom: 'Site Yopougon',
    adresse_ou_repere: "Pres de la station principale",
    latitude: '5.336400',
    longitude: '-4.079200',
    rayon_km: '2',
    surface: '100',
    date_debut: '2026-05-26',
    date_fin: '',
    responsable_gs_email: 'superviseur.general',
    statut: 'ACTIVE',
    description: '',
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function parseSiteImportFile(file: File): Promise<SiteImportNormalizedRow[]> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const extension = file.name.toLowerCase().split('.').pop();

  if (extension === 'csv') {
    return parseCsv(buffer.toString('utf8'));
  }

  if (extension !== 'xlsx') {
    throw new Error('FORMAT_UNSUPPORTED');
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    return [];
  }

  const headerMap = buildHeaderMap(worksheet.getRow(1).values);
  const rows: SiteImportNormalizedRow[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }

    const normalized = normalizeRow(rowNumber, (column) => cellToString(row.getCell(headerMap.get(column) ?? 0).value));
    if (hasAnyValue(normalized)) {
      rows.push(normalized);
    }
  });

  return rows;
}

export async function previewSiteImport(
  prisma: PrismaClient,
  payload: {
    projectId: string;
    user: AuthLikeUser;
    rows: SiteImportNormalizedRow[];
  },
): Promise<SiteImportPreviewResponse> {
  const validations = await validateSiteImportRows(prisma, payload);
  return buildPreviewResponse(payload.projectId, validations.map((item) => item.row));
}

export async function commitSiteImport(
  prisma: PrismaClient,
  payload: {
    projectId: string;
    user: AuthLikeUser;
    rows: SiteImportNormalizedRow[];
  },
): Promise<SiteImportCommitResponse> {
  const validations = await validateSiteImportRows(prisma, payload);
  const validItems = validations.filter((item): item is SiteImportValidation & { input: CreateSiteInput } =>
    item.row.valid && item.input !== null,
  );

  if (validItems.length > 0) {
    await prisma.site.createMany({
      data: validItems.map(({ input }) => ({
        projectId: payload.projectId,
        name: input.name,
        address: input.address,
        latitude: new Prisma.Decimal(input.latitude),
        longitude: new Prisma.Decimal(input.longitude),
        radiusKm: new Prisma.Decimal(input.radiusKm),
        description: input.description,
        status: input.status ?? SiteStatus.ACTIVE,
        area: new Prisma.Decimal(input.area),
        startDate: new Date(input.startDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
        siteManagerId: input.siteManagerId,
        createdById: payload.user.id,
      })),
    });
  }

  return {
    ...buildPreviewResponse(payload.projectId, validations.map((item) => item.row)),
    createdCount: validItems.length,
    skippedCount: validations.length - validItems.length,
  };
}

export function parseSiteImportRowsPayload(value: unknown): SiteImportNormalizedRow[] | null {
  if (!isRecord(value) || !Array.isArray(value.rows)) {
    return null;
  }

  const rows = value.rows.map((row, index) => normalizePayloadRow(row, index + 2));
  return rows.every((row) => row !== null) ? rows : null;
}

export function jsonSiteImportError(code: ProjectApiErrorCode, status: number, message: string) {
  return Response.json({ code, message }, { status });
}

async function validateSiteImportRows(
  prisma: PrismaClient,
  payload: {
    projectId: string;
    user: AuthLikeUser;
    rows: SiteImportNormalizedRow[];
  },
): Promise<SiteImportValidation[]> {
  const [existingSites, siteManagers] = await Promise.all([
    prisma.site.findMany({
      where: { projectId: payload.projectId },
      select: { id: true, name: true, latitude: true, longitude: true },
    }),
    prisma.user.findMany({
      where: { role: 'GENERAL_SUPERVISOR', isActive: true },
      select: { id: true, email: true, username: true },
    }),
  ]);

  const siteManagerByIdentifier = new Map<string, string>();
  for (const manager of siteManagers) {
    siteManagerByIdentifier.set(manager.username.trim().toLowerCase(), manager.id);
    if (manager.email) {
      siteManagerByIdentifier.set(manager.email.trim().toLowerCase(), manager.id);
    }
  }
  const existingNames = new Set(existingSites.map((site) => normalizeName(site.name)));
  const seenNames = new Map<string, number>();

  const validations: SiteImportValidation[] = [];

  for (const row of payload.rows) {
    const errors: SiteImportFieldError[] = [];
    const warnings: SiteImportWarning[] = [];
    const normalizedName = normalizeName(row.nom);
    const previousRow = seenNames.get(normalizedName);

    if (!row.nom.trim()) {
      errors.push({ field: 'nom', message: 'Nom requis.' });
    } else if (previousRow) {
      errors.push({ field: 'nom', message: `Nom deja present dans le fichier ligne ${previousRow}.` });
    } else if (existingNames.has(normalizedName)) {
      errors.push({ field: 'nom', message: 'Un chantier porte deja ce nom dans ce projet.' });
    }

    if (normalizedName) {
      seenNames.set(normalizedName, row.rowNumber);
    }

    const managerIdentifier = row.responsable_gs_email.trim().toLowerCase();
    const managerId = siteManagerByIdentifier.get(managerIdentifier);
    if (!managerIdentifier) {
      errors.push({ field: 'responsable_gs_email', message: 'Identifiant ou email responsable GS requis.' });
    } else if (!managerId) {
      errors.push({ field: 'responsable_gs_email', message: 'Responsable GS actif introuvable avec cet identifiant ou email.' });
    }

    const rawInput = {
      name: row.nom,
      address: row.adresse_ou_repere || SITE_ADDRESS_NOT_PROVIDED,
      latitude: row.latitude,
      longitude: row.longitude,
      radiusKm: row.rayon_km || undefined,
      area: row.surface || 0,
      startDate: row.date_debut,
      endDate: row.date_fin || null,
      siteManagerId: managerId ?? row.responsable_gs_email,
      status: row.statut || SiteStatus.ACTIVE,
      description: row.description,
    };
    const input = parseCreateSiteInput(rawInput);

    if (!input) {
      addGenericFieldErrors(row, errors);
    } else {
      const geofencingError = assertCreateSiteRadiusAllowed(payload.user, input);
      if (geofencingError) {
        errors.push({ field: 'rayon_km', message: 'Seuls DIRECTION et ADMIN peuvent importer un rayon explicite.' });
      }

      if (!validateRadius(input.radiusKm)) {
        errors.push({ field: 'rayon_km', message: 'Rayon compris entre 0.5 et 10 km requis.' });
      }

      if (!validateLatitude(input.latitude)) {
        errors.push({ field: 'latitude', message: 'Latitude comprise entre -90 et 90 requise.' });
      }

      if (!validateLongitude(input.longitude)) {
        errors.push({ field: 'longitude', message: 'Longitude comprise entre -180 et 180 requise.' });
      }

      if (!validateDateRange(input.startDate, input.endDate)) {
        errors.push({ field: 'date_fin', message: 'La date de fin doit etre superieure a la date de debut.' });
      }

      if (managerId && !(await validateSiteManager(prisma, managerId))) {
        errors.push({ field: 'responsable_gs_email', message: 'Responsable chantier invalide.' });
      }

      const closeSite = findCloseExistingSite(existingSites, input.latitude, input.longitude);
      if (closeSite) {
        warnings.push({
          field: 'row',
          message: `Coordonnees proches du chantier existant "${closeSite.name}".`,
        });
      }
    }

    validations.push({
      input: errors.length === 0 ? input : null,
      row: {
        rowNumber: row.rowNumber,
        normalized: row,
        errors,
        warnings,
        valid: errors.length === 0,
      },
    });
  }

  return validations;
}

function buildPreviewResponse(projectId: string, rows: SiteImportPreviewRow[]): SiteImportPreviewResponse {
  return {
    projectId,
    totalRows: rows.length,
    validRows: rows.filter((row) => row.valid).length,
    errorRows: rows.filter((row) => row.errors.length > 0).length,
    warningRows: rows.filter((row) => row.warnings.length > 0).length,
    rows,
  };
}

function addGenericFieldErrors(row: SiteImportNormalizedRow, errors: SiteImportFieldError[]) {
  if (!row.latitude.trim() || Number.isNaN(Number(row.latitude))) {
    errors.push({ field: 'latitude', message: 'Latitude numerique requise.' });
  }
  if (!row.longitude.trim() || Number.isNaN(Number(row.longitude))) {
    errors.push({ field: 'longitude', message: 'Longitude numerique requise.' });
  }
  if (row.surface.trim() && Number.isNaN(Number(row.surface))) {
    errors.push({ field: 'surface', message: 'Surface estimee numerique invalide.' });
  }
  if (!isValidImportDateValue(row.date_debut)) {
    errors.push({ field: 'date_debut', message: 'Date de debut requise au format AAAA-MM-JJ.' });
  }
  if (row.date_fin.trim() && !isValidImportDateValue(row.date_fin)) {
    errors.push({ field: 'date_fin', message: 'Date de fin invalide. Utilisez le format AAAA-MM-JJ.' });
  }
  if (row.statut.trim() && !Object.values(SiteStatus).includes(row.statut.trim() as SiteStatus)) {
    errors.push({ field: 'statut', message: 'Statut invalide.' });
  }
  if (errors.length === 0) {
    errors.push({ field: 'row', message: 'Ligne invalide.' });
  }
}

function parseCsv(content: string) {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    return [];
  }

  const headers = splitCsvLine(lines[0] ?? '');
  const headerMap = buildHeaderMap(['', ...headers]);
  return lines.slice(1).map((line, index) => {
    const values = splitCsvLine(line);
    return normalizeRow(index + 2, (column) => values[(headerMap.get(column) ?? 0) - 1] ?? '');
  }).filter(hasAnyValue);
}

function splitCsvLine(line: string | string[]) {
  if (Array.isArray(line)) {
    return line.map(String);
  }

  const values: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  values.push(current.trim());
  return values;
}

function buildHeaderMap(values: unknown) {
  const headers = Array.isArray(values) ? values : [];
  const map = new Map<SiteImportColumnKey, number>();
  headers.forEach((value, index) => {
    const key = normalizeHeader(cellToString(value));
    const column = SITE_IMPORT_COLUMNS.find((item) => item.key === key);
    if (column) {
      map.set(column.key, index);
    }
  });
  return map;
}

function normalizeRow(rowNumber: number, getValue: (key: SiteImportColumnKey) => string): SiteImportNormalizedRow {
  return {
    rowNumber,
    nom: getValue('nom').trim(),
    adresse_ou_repere: getValue('adresse_ou_repere').trim(),
    latitude: getValue('latitude').trim(),
    longitude: getValue('longitude').trim(),
    rayon_km: getValue('rayon_km').trim(),
    surface: getValue('surface').trim(),
    date_debut: normalizeDateValue(getValue('date_debut')),
    date_fin: normalizeDateValue(getValue('date_fin')),
    responsable_gs_email: getValue('responsable_gs_email').trim(),
    statut: getValue('statut').trim().toUpperCase(),
    description: getValue('description').trim(),
  };
}

function normalizePayloadRow(value: unknown, fallbackRowNumber: number): SiteImportNormalizedRow | null {
  if (!isRecord(value)) {
    return null;
  }

  return normalizeRow(typeof value.rowNumber === 'number' ? value.rowNumber : fallbackRowNumber, (key) =>
    typeof value[key] === 'string' ? value[key] : '',
  );
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object' && 'text' in value) {
    const richValue = value as { text?: unknown };
    if (typeof richValue.text === 'string') {
      return richValue.text;
    }
  }
  if (typeof value === 'object') {
    return '';
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  return '';
}

function normalizeDateValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  const isoDate = coerceImportDateToIso(trimmed);
  return isoDate ?? trimmed;
}

function isValidImportDateValue(value: string) {
  return Boolean(coerceImportDateToIso(value));
}

function coerceImportDateToIso(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return isSafeDateParts(trimmed) ? trimmed : null;
  }

  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slashMatch) {
    const day = Number(slashMatch[1] ?? '');
    const month = Number(slashMatch[2] ?? '');
    const year = Number(slashMatch[3] ?? '');
    return buildIsoDate(year, month, day);
  }

  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const serial = Number(trimmed);
    if (Number.isFinite(serial) && serial >= 1 && serial <= 100000) {
      return excelSerialToIsoDate(serial);
    }
    return null;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth() + 1;
  const day = parsed.getUTCDate();
  return buildIsoDate(year, month, day);
}

function excelSerialToIsoDate(serial: number) {
  const wholeDays = Math.floor(serial);
  const excelEpochUtc = Date.UTC(1899, 11, 30);
  const parsed = new Date(excelEpochUtc + wholeDays * 24 * 60 * 60 * 1000);
  return buildIsoDate(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
}

function isSafeDateParts(isoDate: string) {
  const [yearValue = Number.NaN, monthValue = Number.NaN, dayValue = Number.NaN] = isoDate.split('-').map(Number);
  return Boolean(buildIsoDate(yearValue, monthValue, dayValue));
}

function buildIsoDate(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function normalizeHeader(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
  if (normalized === 'surface_estimee') {
    return 'surface';
  }
  if (
    normalized === 'responsable_gs_identifiant' ||
    normalized === 'responsable_gs_username' ||
    normalized === 'responsable_gs'
  ) {
    return 'responsable_gs_email';
  }
  return normalized as SiteImportColumnKey;
}

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function hasAnyValue(row: SiteImportNormalizedRow) {
  return SITE_IMPORT_COLUMNS.some((column) => row[column.key].trim() !== '');
}

function validateLatitude(value: number) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function validateLongitude(value: number) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function findCloseExistingSite(sites: ExistingSite[], latitude: number, longitude: number) {
  return sites.find((site) => {
    const distance = distanceKm(
      latitude,
      longitude,
      site.latitude.toNumber(),
      site.longitude.toNumber(),
    );
    return distance <= CLOSE_COORDINATE_THRESHOLD_KM;
  });
}

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
