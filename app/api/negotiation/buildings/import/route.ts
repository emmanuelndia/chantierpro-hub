import ExcelJS from 'exceljs';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canManageNegotiation, negotiationProjectWhere, normalizeNegotiationZoneName } from '@/lib/negotiation';

type ImportRow = {
  region: string | null;
  zoneName: string;
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
  importKey: string;
  errors: string[];
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
  const validRows = rows.filter((row) => row.errors.length === 0);
  const zoneKeys = new Map<string, ImportRow>();
  for (const row of validRows) {
    zoneKeys.set(normalizeNegotiationZoneName(row.zoneName), row);
  }

  let createdZones = 0;
  let createdScopes = 0;
  let updatedScopes = 0;

  if (mode === 'commit') {
    const result = await prisma.$transaction(async (tx) => {
      let zoneCreateCount = 0;
      let scopeCreateCount = 0;
      let scopeUpdateCount = 0;
      const zoneIds = new Map<string, string>();

      for (const [normalizedName, row] of zoneKeys.entries()) {
        const existingZone = await tx.negotiationZone.findUnique({
          where: { projectId_normalizedName: { projectId, normalizedName } },
          select: { id: true },
        });
        if (existingZone) {
          zoneIds.set(normalizedName, existingZone.id);
          const zoneUpdateData: { city?: string; region?: string } = {};
          if (row.city) zoneUpdateData.city = row.city;
          if (row.region) zoneUpdateData.region = row.region;
          await tx.negotiationZone.update({
            where: { id: existingZone.id },
            data: zoneUpdateData,
          });
          continue;
        }

        const zone = await tx.negotiationZone.create({
          data: {
            projectId,
            name: row.zoneName,
            normalizedName,
            city: row.city,
            region: row.region,
          },
          select: { id: true },
        });
        zoneIds.set(normalizedName, zone.id);
        zoneCreateCount += 1;
      }

      for (const row of validRows) {
        const normalizedZone = normalizeNegotiationZoneName(row.zoneName);
        const zoneId = zoneIds.get(normalizedZone) ?? null;
        const existingScope = await tx.negotiationBuilding.findFirst({
          where: {
            projectId,
            zoneId,
            name: { equals: row.name, mode: 'insensitive' },
          },
          select: { id: true },
        });
        const scopeData = {
          zoneId,
          cluster: row.cluster,
          city: row.city,
          commune: row.commune,
          plaque: row.plaque,
          habitation: row.habitation,
          name: row.name,
          contactInfo: row.contactInfo,
          level: row.level,
          targetEl: row.targetEl,
          actualEl: row.actualEl,
          longitude: row.longitude,
          latitude: row.latitude,
          layer: row.layer,
          color: row.color,
          operatorPresence: row.operatorPresence,
          negotiationStatus: row.negotiationStatus,
          remark: row.remark,
          sourceImportName: file.name,
        };

        if (existingScope) {
          await tx.negotiationBuilding.update({
            where: { id: existingScope.id },
            data: scopeData,
          });
          scopeUpdateCount += 1;
        } else {
          await tx.negotiationBuilding.create({
            data: {
              projectId,
              ...scopeData,
            },
          });
          scopeCreateCount += 1;
        }
      }

      return { zoneCreateCount, scopeCreateCount, scopeUpdateCount };
    });
    createdZones = result.zoneCreateCount;
    createdScopes = result.scopeCreateCount;
    updatedScopes = result.scopeUpdateCount;
  }

  return Response.json({
    mode,
    totalRows: rows.length,
    validRows: validRows.length,
    invalidRows: rows.length - validRows.length,
    detectedZones: zoneKeys.size,
    createdZones,
    createdScopes,
    updatedScopes,
    preview: validRows.slice(0, 20).map((row) => ({
      zoneName: row.zoneName,
      name: row.name,
      city: row.city,
      contactInfo: row.contactInfo,
      negotiationStatus: row.negotiationStatus,
    })),
    invalidPreview: rows.filter((row) => row.errors.length > 0).slice(0, 20).map((row) => ({
      name: row.name,
      city: row.city,
      zoneName: row.zoneName,
      errors: row.errors,
    })),
  });
});

async function parseHpBuildingsWorkbook(file: File): Promise<ImportRow[]> {
  const workbook = new ExcelJS.Workbook();
  const buffer = Buffer.from(await file.arrayBuffer());
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.getWorksheet('Suivi Propriétaires Immeubles') ?? workbook.getWorksheet('HUB') ?? workbook.worksheets[0];

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
    const name = readFirst(row, headerMap, ['NOM DE L’IMMEUBLE', 'NOM DE L IMMEUBLE', 'NOM IMMEUBLE']);
    const city = readFirst(row, headerMap, ['VILLE']);
    const zoneName = readFirst(row, headerMap, ['COMMUNE/QUARTIER', 'COMMUNE', 'QUARTIER']);

    if (!name && !city && !zoneName) {
      continue;
    }
    const longitude = readGps(row, headerMap, 'longitude');
    const latitude = readGps(row, headerMap, 'latitude');
    const owner = readFirst(row, headerMap, ['NOM DU PROPRIETAIRE', 'NOM DU PROPRIÉTAIRE', 'INFORMATIONS INTERLOCUTEURS']);
    const phone1 = read(row, headerMap, 'TELEPHONE 1');
    const phone2 = read(row, headerMap, 'TELEPHONE 2');
    const email = read(row, headerMap, 'EMAIL');
    const comments = readFirst(row, headerMap, ['COMMENTAIRES', 'REMARQUE']);
    const status = readFirst(row, headerMap, ['STATUT ACCORD (A CONTACTER / EN COURS / SIGNE)', 'STATUT ACCORD', 'STATUT NEGOCIATION']);
    const contactInfo = [owner, phone1, phone2, email].filter(Boolean).join(' - ');
    const errors = [];
    if (!name) errors.push('Nom du scope obligatoire.');
    if (!zoneName) errors.push('Commune/Quartier obligatoire pour créer la zone.');

    rows.push({
      region: nullable(read(row, headerMap, 'REGION')),
      zoneName: zoneName || 'Zone non renseignee',
      cluster: nullable(readFirst(row, headerMap, ['CLUSTER', 'REGION'])),
      city: city || 'Non renseigne',
      commune: nullable(zoneName),
      plaque: nullable(read(row, headerMap, 'PLAQUE')),
      habitation: nullable(readFirst(row, headerMap, ['TYPE DE PROPRIETE (RESIDENTIEL / COMMERCIAL / MIXTE)', 'TYPE DE PROPRIÉTÉ (RÉSIDENTIEL / COMMERCIAL / MIXTE)', 'HABITATION'])),
      name: name || '',
      contactInfo: nullable(contactInfo),
      level: nullable(readFirst(row, headerMap, ['ADRESSE', 'NIVEAU DE ELS'])),
      targetEl: numberOrNull(read(row, headerMap, 'EL')),
      actualEl: numberOrNull(read(row, headerMap, 'EL REEL')),
      longitude,
      latitude,
      layer: nullable(read(row, headerMap, 'FOURNISSEUR INTERNET ACTUEL')),
      color: nullable(read(row, headerMap, 'OFFRE PROMOTIONNELLE DE 50MBPS (3 OU 6 MOIS)')),
      operatorPresence: nullable(read(row, headerMap, 'FAISABILITE TECHNIQUE (OUI/NON)')),
      negotiationStatus: normalizeNegotiationStatus(status),
      remark: nullable(comments) ?? nullable(status),
      importKey: `${normalizeNegotiationZoneName(zoneName)}:${normalizeHeader(name)}`,
      errors,
    });
  }

  return rows;
}

function read(row: ExcelJS.Row, headerMap: Map<string, number>, header: string) {
  const index = headerMap.get(normalizeHeader(header));
  return index ? cellText(row.getCell(index)) : '';
}

function readFirst(row: ExcelJS.Row, headerMap: Map<string, number>, headers: string[]) {
  for (const header of headers) {
    const value = read(row, headerMap, header);
    if (value) return value;
  }
  return '';
}

function readGps(row: ExcelJS.Row, headerMap: Map<string, number>, kind: 'longitude' | 'latitude') {
  const explicit = readFirst(row, headerMap, kind === 'longitude' ? ['LONGITUDE'] : ['LATITUDE']);
  if (explicit) return numberOrNull(explicit);
  const mergedHeaderIndex = headerMap.get(normalizeHeader('COORDONNEES GPS'));
  if (!mergedHeaderIndex) return null;
  const offset = kind === 'longitude' ? 0 : 1;
  return numberOrNull(cellText(row.getCell(mergedHeaderIndex + offset)));
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

function normalizeNegotiationStatus(value: string) {
  const normalized = normalizeHeader(value);
  if (!normalized) return null;
  if (normalized.includes('OK') || normalized.includes('SIGNE')) return 'OK';
  if (normalized.includes('REFUS') || normalized.includes('NON OBTENU')) return 'REFUS';
  if (normalized.includes('REVISITER')) return 'A_REVISITER';
  if (normalized.includes('ABSENT')) return 'ABSENT';
  if (normalized.includes('EN COURS') || normalized.includes('CONTACTER')) return 'EN_COURS';
  return value.trim() || null;
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
