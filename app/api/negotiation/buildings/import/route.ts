import ExcelJS from 'exceljs';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canManageNegotiation, negotiationProjectWhere } from '@/lib/negotiation';

type ImportRow = {
  cluster: string | null;
  city: string;
  commune: string | null;
  plaque: string | null;
  habitation: string | null;
  name: string;
  contactInfo: string | null;
  level: string | null;
  targetEl: number | null;
  actualEl: number | null;
  longitude: number | null;
  latitude: number | null;
  layer: string | null;
  color: string | null;
  operatorPresence: string | null;
  negotiationStatus: string | null;
  remark: string | null;
};

export const POST = withAuth(async ({ req, user }) => {
  if (!canManageNegotiation(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Import negociation refuse.' }, { status: 403 });
  }

  const formData = await req.formData();
  const projectId = formDataText(formData.get('projectId'));
  const mode = formDataText(formData.get('mode')) || 'preview';
  const file = formData.get('file');

  if (!projectId || !(file instanceof File)) {
    return Response.json({ code: 'BAD_REQUEST', message: 'Projet et fichier Excel obligatoires.' }, { status: 400 });
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, ...negotiationProjectWhere(user) },
    select: { id: true },
  });
  if (!project) {
    return Response.json({ code: 'PROJECT_NOT_FOUND', message: 'Projet introuvable ou inactif.' }, { status: 404 });
  }

  const rows = await parseHpBuildingsWorkbook(file);
  const validRows = rows.filter((row) => row.city && row.name);

  if (mode === 'commit') {
    await prisma.negotiationBuilding.createMany({
      data: validRows.map((row) => ({
        ...row,
        projectId,
        sourceImportName: file.name,
      })),
    });
  }

  return Response.json({
    mode,
    totalRows: rows.length,
    validRows: validRows.length,
    invalidRows: rows.length - validRows.length,
    preview: validRows.slice(0, 20),
  });
});

async function parseHpBuildingsWorkbook(file: File): Promise<ImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  const buffer = Buffer.from(await file.arrayBuffer());
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.getWorksheet('HUB') ?? workbook.worksheets[0];

  if (!worksheet) {
    return [];
  }

  const headerRow = worksheet.getRow(1);
  const headerMap = new Map<string, number>();
  headerRow.eachCell((cell, colNumber) => {
    headerMap.set(normalizeHeader(cellText(cell)), colNumber);
  });

  const rows: ImportRow[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const name = read(row, headerMap, 'NOM IMMEUBLE');
    const city = read(row, headerMap, 'VILLE');

    if (!name && !city) {
      continue;
    }

    rows.push({
      cluster: nullable(read(row, headerMap, 'CLUSTER')),
      city: city || 'Non renseigne',
      commune: nullable(read(row, headerMap, 'COMMUNE')),
      plaque: nullable(read(row, headerMap, 'PLAQUE')),
      habitation: nullable(read(row, headerMap, 'HABITATION')),
      name: name || 'Immeuble non renseigne',
      contactInfo: nullable(read(row, headerMap, 'INFORMATIONS INTERLOCUTEURS')),
      level: nullable(read(row, headerMap, 'NIVEAU DE ELS')),
      targetEl: numberOrNull(read(row, headerMap, 'EL')),
      actualEl: numberOrNull(read(row, headerMap, 'EL REEL')),
      longitude: numberOrNull(read(row, headerMap, 'LONGITUDE')),
      latitude: numberOrNull(read(row, headerMap, 'LATITUDE')),
      layer: nullable(read(row, headerMap, 'CALQUE')),
      color: nullable(read(row, headerMap, 'COULEUR')),
      operatorPresence: nullable(read(row, headerMap, 'PRESENCE OPERATEUR')),
      negotiationStatus: nullable(read(row, headerMap, 'STATUT NEGOCIATION')),
      remark: nullable(read(row, headerMap, 'STATUT NEGOCIATION')),
    });
  }

  return rows;
}

function read(row: ExcelJS.Row, headerMap: Map<string, number>, header: string) {
  const index = headerMap.get(normalizeHeader(header));
  return index ? cellText(row.getCell(index)) : '';
}

function cellText(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    if ('text' in value && value.text) {
      return String(value.text).trim();
    }
    if ('result' in value && value.result !== undefined && value.result !== null) {
      return primitiveText(value.result);
    }
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text).join('').trim();
    }
    return '';
  }
  return String(value).trim();
}

function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function nullable(value: string) {
  return value.trim() || null;
}

function numberOrNull(value: string) {
  if (!value.trim()) {
    return null;
  }
  const number = Number(value.replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function formDataText(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.trim() : '';
}

function primitiveText(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }

  return '';
}
