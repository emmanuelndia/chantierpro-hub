/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import ExcelJS from 'exceljs';
import { Prisma, Role, type PrismaClient } from '@prisma/client';
import type {
  FleetVehicleAssignmentSummary,
  FleetVehicleCurrentAssignment,
  FleetVehicleImportPreviewRow,
  FleetVehicleImportResponse,
  FleetVehiclePayload,
  FleetVehiclePersonSummary,
  FleetVehiclesResponse,
  FleetVehicleSummary,
} from '@/types/fleet-vehicles';

const fleetVehicleSelect = {
  id: true,
  registrationNumber: true,
  brand: true,
  model: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  assignments: {
    where: { isActive: true },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    take: 1,
    select: {
      id: true,
      startDate: true,
      endDate: true,
      isActive: true,
      driverUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
        },
      },
      apprenticeUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          username: true,
        },
      },
    },
  },
} as const;

const currentFleetAssignmentSelect = {
  id: true,
  startDate: true,
  driverUserId: true,
  apprenticeUserId: true,
  vehicle: {
    select: {
      id: true,
      registrationNumber: true,
      brand: true,
      model: true,
    },
  },
} as const;

type ImportContext = {
  resources: FleetVehiclePersonSummary[];
};

type FleetEnabledPrismaClient = PrismaClient & {
  fleetVehicle: {
    findMany: (...args: any[]) => Promise<any[]>;
    findUnique: (...args: any[]) => Promise<any>;
    findFirst: (...args: any[]) => Promise<any>;
    findUniqueOrThrow: (...args: any[]) => Promise<any>;
    create: (...args: any[]) => Promise<any>;
    update: (...args: any[]) => Promise<any>;
  };
  fleetVehicleAssignment: {
    findFirst: (...args: any[]) => Promise<any>;
    findMany: (...args: any[]) => Promise<any[]>;
    create: (...args: any[]) => Promise<any>;
    update: (...args: any[]) => Promise<any>;
  };
};

function withFleetClient(prisma: PrismaClient) {
  return prisma as FleetEnabledPrismaClient;
}

function withFleetTransaction(tx: Prisma.TransactionClient) {
  return tx as Prisma.TransactionClient & {
    fleetVehicle: FleetEnabledPrismaClient['fleetVehicle'];
    fleetVehicleAssignment: FleetEnabledPrismaClient['fleetVehicleAssignment'];
  };
}

export function canManageFleetVehicles(role: Role) {
  return role === Role.ADMIN || role === Role.FLEET_MANAGER;
}

export async function listFleetVehicles(prisma: PrismaClient): Promise<FleetVehiclesResponse> {
  const db = withFleetClient(prisma);
  const [items, resources] = await Promise.all([
    db.fleetVehicle.findMany({
      orderBy: [{ isActive: 'desc' }, { registrationNumber: 'asc' }],
      select: fleetVehicleSelect,
    }),
    prisma.user.findMany({
      where: {
        role: Role.FLEET_RESOURCE,
        isActive: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        username: true,
      },
    }),
  ]);

  return {
    items: items.map(serializeFleetVehicle),
    availableResources: resources.map(serializeFleetPerson),
  };
}

export function parseFleetVehiclePayload(body: unknown): FleetVehiclePayload | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const input = body as Record<string, unknown>;
  const registrationNumber = sanitizeText(input.registrationNumber);
  const brand = sanitizeText(input.brand);
  const model = sanitizeText(input.model);
  const driverUserId = sanitizeText(input.driverUserId);
  const apprenticeUserId = sanitizeNullableText(input.apprenticeUserId);
  const startDate = sanitizeDate(input.startDate) ?? new Date().toISOString().slice(0, 10);
  const isActive = typeof input.isActive === 'boolean' ? input.isActive : true;

  if (!registrationNumber || !brand || !model || !driverUserId || !startDate) {
    return null;
  }

  if (apprenticeUserId && apprenticeUserId === driverUserId) {
    return null;
  }

  return {
    registrationNumber: normalizeRegistrationNumber(registrationNumber),
    brand,
    model,
    isActive,
    driverUserId,
    apprenticeUserId,
    startDate,
  };
}

export async function createFleetVehicle(
  prisma: PrismaClient,
  payload: FleetVehiclePayload,
): Promise<FleetVehicleSummary> {
  const db = withFleetClient(prisma);
  const startDate = toUtcDate(payload.startDate ?? null);
  await ensureFleetVehicleUsers(prisma, payload.driverUserId, payload.apprenticeUserId ?? null);

  const created = await db.$transaction(async (rawTx) => {
    const tx = withFleetTransaction(rawTx);
    const existingVehicle = await tx.fleetVehicle.findUnique({
      where: { registrationNumber: payload.registrationNumber },
      select: { id: true },
    });

    if (existingVehicle) {
      throw new Error('Cette immatriculation existe deja.');
    }

    await closeConflictingActiveAssignments(tx, {
      vehicleId: null,
      driverUserId: payload.driverUserId,
      apprenticeUserId: payload.apprenticeUserId ?? null,
      closeAt: startDate,
    });

    const vehicle = await tx.fleetVehicle.create({
      data: {
        registrationNumber: payload.registrationNumber,
        brand: payload.brand,
        model: payload.model,
        isActive: payload.isActive,
      },
      select: { id: true },
    });

    await tx.fleetVehicleAssignment.create({
      data: {
        vehicleId: vehicle.id,
        driverUserId: payload.driverUserId,
        apprenticeUserId: payload.apprenticeUserId ?? null,
        startDate,
        isActive: true,
      },
    });

    return tx.fleetVehicle.findUniqueOrThrow({
      where: { id: vehicle.id },
      select: fleetVehicleSelect,
    });
  });

  return serializeFleetVehicle(created);
}

export async function updateFleetVehicle(
  prisma: PrismaClient,
  vehicleId: string,
  payload: FleetVehiclePayload,
): Promise<FleetVehicleSummary> {
  const db = withFleetClient(prisma);
  const startDate = toUtcDate(payload.startDate ?? null);
  await ensureFleetVehicleUsers(prisma, payload.driverUserId, payload.apprenticeUserId ?? null);

  const updated = await db.$transaction(async (rawTx) => {
    const tx = withFleetTransaction(rawTx);
    const vehicle = await tx.fleetVehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, registrationNumber: true },
    });

    if (!vehicle) {
      throw new Error('Vehicule introuvable.');
    }

    const duplicate = await tx.fleetVehicle.findFirst({
      where: {
        id: { not: vehicleId },
        registrationNumber: payload.registrationNumber,
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new Error('Cette immatriculation existe deja.');
    }

    await tx.fleetVehicle.update({
      where: { id: vehicleId },
      data: {
        registrationNumber: payload.registrationNumber,
        brand: payload.brand,
        model: payload.model,
        isActive: payload.isActive,
      },
    });

    const currentActive = await tx.fleetVehicleAssignment.findFirst({
      where: { vehicleId, isActive: true },
      orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        driverUserId: true,
        apprenticeUserId: true,
        startDate: true,
      },
    });

    const sameAssignment =
      currentActive?.driverUserId === payload.driverUserId &&
      (currentActive?.apprenticeUserId ?? null) === (payload.apprenticeUserId ?? null) &&
      currentActive?.startDate.toISOString().slice(0, 10) === startDate.toISOString().slice(0, 10);

    if (!sameAssignment) {
      await closeConflictingActiveAssignments(tx, {
        vehicleId,
        driverUserId: payload.driverUserId,
        apprenticeUserId: payload.apprenticeUserId ?? null,
        closeAt: startDate,
      });

      if (currentActive) {
        await tx.fleetVehicleAssignment.update({
          where: { id: currentActive.id },
          data: {
            isActive: false,
            endDate: chooseAssignmentEndDate(currentActive.startDate, startDate),
          },
        });
      }

      await tx.fleetVehicleAssignment.create({
        data: {
          vehicleId,
          driverUserId: payload.driverUserId,
          apprenticeUserId: payload.apprenticeUserId ?? null,
          startDate,
          isActive: true,
        },
      });
    }

    return tx.fleetVehicle.findUniqueOrThrow({
      where: { id: vehicleId },
      select: fleetVehicleSelect,
    });
  });

  return serializeFleetVehicle(updated);
}

export async function getCurrentFleetVehicleAssignmentForUser(
  prisma: PrismaClient,
  userId: string,
): Promise<FleetVehicleCurrentAssignment | null> {
  const db = withFleetClient(prisma);
  const current = await db.fleetVehicleAssignment.findFirst({
    where: {
      isActive: true,
      OR: [{ driverUserId: userId }, { apprenticeUserId: userId }],
    },
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
    select: currentFleetAssignmentSelect,
  });

  return current ? serializeCurrentFleetAssignment(current, userId) : null;
}

export async function parseFleetVehicleWorkbook(file: File, prisma: PrismaClient): Promise<FleetVehicleImportPreviewRow[]> {
  const context = await loadImportContext(prisma);
  const workbook = new ExcelJS.Workbook();
  const buffer = Buffer.from(await file.arrayBuffer());
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    return [];
  }

  const headerRowIndex = findFleetHeaderRowIndex(worksheet);
  if (!headerRowIndex) {
    throw new Error('Colonnes IMMAT, MARQUE, MODELE, CHAUFFEUR, APPRENTI introuvables.');
  }

  const headerMap = buildFleetHeaderMap(worksheet.getRow(headerRowIndex));
  const rows: FleetVehicleImportPreviewRow[] = [];

  for (let rowNumber = headerRowIndex + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const registrationNumber = normalizeRegistrationNumber(readFleetCell(row, headerMap.immat));
    const brand = readFleetCell(row, headerMap.brand);
    const model = readFleetCell(row, headerMap.model);
    const driverLabel = readFleetCell(row, headerMap.driver);
    const apprenticeLabel = sanitizeNullableText(readFleetCell(row, headerMap.apprentice));

    if (![registrationNumber, brand, model, driverLabel, apprenticeLabel ?? ''].some((value) => value.trim().length > 0)) {
      continue;
    }

    const resolvedDriver = findFleetResourceByName(driverLabel, context.resources);
    const resolvedApprentice = apprenticeLabel ? findFleetResourceByName(apprenticeLabel, context.resources) : null;

    const errors: string[] = [];
    if (!registrationNumber) errors.push('Immatriculation obligatoire.');
    if (!brand) errors.push('Marque obligatoire.');
    if (!model) errors.push('Modele obligatoire.');
    if (!driverLabel) errors.push('Chauffeur obligatoire.');
    if (!resolvedDriver) errors.push('Chauffeur introuvable parmi les ressources parc auto.');
    if (apprenticeLabel && !resolvedApprentice) errors.push('Apprenti introuvable parmi les ressources parc auto.');
    if (resolvedDriver?.id && resolvedApprentice?.id && resolvedDriver.id === resolvedApprentice.id) {
      errors.push('Le chauffeur et l apprenti doivent etre differents.');
    }

    rows.push({
      id: `fleet:${rowNumber}`,
      rowNumber,
      registrationNumber,
      brand,
      model,
      driverLabel,
      apprenticeLabel,
      resolvedDriverUserId: resolvedDriver?.id ?? null,
      resolvedApprenticeUserId: resolvedApprentice?.id ?? null,
      valid: errors.length === 0,
      errors,
    });
  }

  return rows;
}

export async function commitFleetVehicleImport(
  prisma: PrismaClient,
  rows: FleetVehicleImportPreviewRow[],
): Promise<FleetVehicleImportResponse> {
  const db = withFleetClient(prisma);
  let createdVehicles = 0;
  let updatedVehicles = 0;
  let createdAssignments = 0;
  let closedAssignments = 0;
  const validRows = rows.filter((row) => row.valid);

  await db.$transaction(async (rawTx) => {
    const tx = withFleetTransaction(rawTx);
    for (const row of validRows) {
      const vehicle = await tx.fleetVehicle.findUnique({
        where: { registrationNumber: row.registrationNumber },
        select: { id: true, brand: true, model: true },
      });

      const closeAt = new Date();
      closeAt.setUTCHours(0, 0, 0, 0);

      if (!vehicle) {
        const createdVehicle = await tx.fleetVehicle.create({
          data: {
            registrationNumber: row.registrationNumber,
            brand: row.brand,
            model: row.model,
            isActive: true,
          },
          select: { id: true },
        });
        createdVehicles += 1;

        const closed = await closeConflictingActiveAssignments(tx, {
          vehicleId: null,
          driverUserId: row.resolvedDriverUserId!,
          apprenticeUserId: row.resolvedApprenticeUserId,
          closeAt,
        });
        closedAssignments += closed;

        await tx.fleetVehicleAssignment.create({
          data: {
            vehicleId: createdVehicle.id,
            driverUserId: row.resolvedDriverUserId!,
            apprenticeUserId: row.resolvedApprenticeUserId,
            startDate: closeAt,
            isActive: true,
          },
        });
        createdAssignments += 1;
        continue;
      }

      if (vehicle.brand !== row.brand || vehicle.model !== row.model) {
        await tx.fleetVehicle.update({
          where: { id: vehicle.id },
          data: {
            brand: row.brand,
            model: row.model,
          },
        });
        updatedVehicles += 1;
      }

      const currentAssignment = await tx.fleetVehicleAssignment.findFirst({
        where: { vehicleId: vehicle.id, isActive: true },
        orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          startDate: true,
          driverUserId: true,
          apprenticeUserId: true,
        },
      });

      const sameAssignment =
        currentAssignment?.driverUserId === row.resolvedDriverUserId &&
        (currentAssignment?.apprenticeUserId ?? null) === (row.resolvedApprenticeUserId ?? null);

      if (!sameAssignment) {
        const closed = await closeConflictingActiveAssignments(tx, {
          vehicleId: vehicle.id,
          driverUserId: row.resolvedDriverUserId!,
          apprenticeUserId: row.resolvedApprenticeUserId,
          closeAt,
        });
        closedAssignments += closed;

        if (currentAssignment) {
          await tx.fleetVehicleAssignment.update({
            where: { id: currentAssignment.id },
            data: {
              isActive: false,
              endDate: chooseAssignmentEndDate(currentAssignment.startDate, closeAt),
            },
          });
          closedAssignments += 1;
        }

        await tx.fleetVehicleAssignment.create({
          data: {
            vehicleId: vehicle.id,
            driverUserId: row.resolvedDriverUserId!,
            apprenticeUserId: row.resolvedApprenticeUserId,
            startDate: closeAt,
            isActive: true,
          },
        });
        createdAssignments += 1;
      }
    }
  });

  return {
    mode: 'commit',
    totalRows: rows.length,
    validRows: validRows.length,
    invalidRows: rows.length - validRows.length,
    createdVehicles,
    updatedVehicles,
    createdAssignments,
    closedAssignments,
    rows,
  };
}

export function buildFleetImportPreviewResponse(rows: FleetVehicleImportPreviewRow[]): FleetVehicleImportResponse {
  return {
    mode: 'preview',
    totalRows: rows.length,
    validRows: rows.filter((row) => row.valid).length,
    invalidRows: rows.filter((row) => !row.valid).length,
    createdVehicles: 0,
    updatedVehicles: 0,
    createdAssignments: 0,
    closedAssignments: 0,
    rows,
  };
}

type SerializableFleetVehicleLike = {
  id: string;
  registrationNumber: string;
  brand: string;
  model: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  assignments: {
    id: string;
    startDate: Date;
    endDate: Date | null;
    isActive: boolean;
    driverUser: {
      id: string;
      firstName: string;
      lastName: string;
      username: string;
    };
    apprenticeUser: {
      id: string;
      firstName: string;
      lastName: string;
      username: string;
    } | null;
  }[];
};

type CurrentFleetAssignmentRecordLike = {
  id: string;
  startDate: Date;
  driverUserId: string;
  apprenticeUserId: string | null;
  vehicle: {
    id: string;
    registrationNumber: string;
    brand: string;
    model: string;
  };
};

function serializeFleetVehicle(item: SerializableFleetVehicleLike): FleetVehicleSummary {
  return {
    id: item.id,
    registrationNumber: item.registrationNumber,
    brand: item.brand,
    model: item.model,
    isActive: item.isActive,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    activeAssignment: item.assignments[0] ? serializeAssignment(item.assignments[0]) : null,
  };
}

function serializeAssignment(
  item: SerializableFleetVehicleLike['assignments'][number],
): FleetVehicleAssignmentSummary {
  return {
    id: item.id,
    startDate: item.startDate.toISOString(),
    endDate: item.endDate?.toISOString() ?? null,
    isActive: item.isActive,
    driver: serializeFleetPerson(item.driverUser),
    apprentice: item.apprenticeUser ? serializeFleetPerson(item.apprenticeUser) : null,
  };
}

function serializeFleetPerson(person: {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
}): FleetVehiclePersonSummary {
  return {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    username: person.username,
  };
}

function serializeCurrentFleetAssignment(
  item: CurrentFleetAssignmentRecordLike,
  userId: string,
): FleetVehicleCurrentAssignment {
  return {
    assignmentId: item.id,
    vehicleId: item.vehicle.id,
    registrationNumber: item.vehicle.registrationNumber,
    brand: item.vehicle.brand,
    model: item.vehicle.model,
    roleInVehicle: item.driverUserId === userId ? 'DRIVER' : 'APPRENTICE',
    startDate: item.startDate.toISOString(),
  };
}

async function ensureFleetVehicleUsers(prisma: PrismaClient, driverUserId: string, apprenticeUserId: string | null) {
  const ids = [driverUserId, apprenticeUserId].filter(Boolean) as string[];
  const users = await prisma.user.findMany({
    where: {
      id: { in: ids },
      role: Role.FLEET_RESOURCE,
      isActive: true,
    },
    select: { id: true },
  });
  if (users.length !== ids.length) {
    throw new Error('Le chauffeur ou l apprenti doit etre une ressource parc auto active.');
  }
}

async function closeConflictingActiveAssignments(
  tx: Prisma.TransactionClient,
  payload: {
    vehicleId: string | null;
    driverUserId: string;
    apprenticeUserId: string | null;
    closeAt: Date;
  },
) {
  const db = withFleetTransaction(tx);
  const orFilters = [] as Record<string, string>[];

  if (payload.vehicleId) {
    orFilters.push({ vehicleId: payload.vehicleId });
  }
  orFilters.push({ driverUserId: payload.driverUserId });
  orFilters.push({ apprenticeUserId: payload.driverUserId });

  if (payload.apprenticeUserId) {
    orFilters.push({ driverUserId: payload.apprenticeUserId });
    orFilters.push({ apprenticeUserId: payload.apprenticeUserId });
  }

  const assignments = await db.fleetVehicleAssignment.findMany({
    where: {
      isActive: true,
      OR: orFilters,
    },
    select: {
      id: true,
      startDate: true,
    },
  });

  let closedCount = 0;
  for (const assignment of assignments) {
    await db.fleetVehicleAssignment.update({
      where: { id: assignment.id },
      data: {
        isActive: false,
        endDate: chooseAssignmentEndDate(assignment.startDate, payload.closeAt),
      },
    });
    closedCount += 1;
  }
  return closedCount;
}

function chooseAssignmentEndDate(startDate: Date, closeAt: Date) {
  return closeAt > startDate ? closeAt : startDate;
}

async function loadImportContext(prisma: PrismaClient): Promise<ImportContext> {
  const resources = await prisma.user.findMany({
    where: {
      role: Role.FLEET_RESOURCE,
      isActive: true,
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true,
    },
  });

  return {
    resources: resources.map(serializeFleetPerson),
  };
}

function findFleetHeaderRowIndex(worksheet: ExcelJS.Worksheet) {
  for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 12); rowNumber += 1) {
    const map = buildFleetHeaderMap(worksheet.getRow(rowNumber));
    if (map.immat && map.brand && map.model && map.driver) {
      return rowNumber;
    }
  }
  return null;
}

function buildFleetHeaderMap(row: ExcelJS.Row) {
  const map = {
    immat: undefined as number | undefined,
    brand: undefined as number | undefined,
    model: undefined as number | undefined,
    driver: undefined as number | undefined,
    apprentice: undefined as number | undefined,
  };

  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const value = normalizeImportText(cellText(cell.value));
    if (!value) return;
    if (!map.immat && ['immat', 'imm', 'immatriculation'].includes(value)) map.immat = colNumber;
    if (!map.brand && ['marque'].includes(value)) map.brand = colNumber;
    if (!map.model && ['modele', 'model'].includes(value)) map.model = colNumber;
    if (!map.driver && ['chauffeur', 'conducteur'].includes(value)) map.driver = colNumber;
    if (!map.apprentice && ['apprenti', 'assistant'].includes(value)) map.apprentice = colNumber;
  });

  return map;
}

function readFleetCell(row: ExcelJS.Row, column: number | undefined) {
  if (!column) return '';
  return cellText(row.getCell(column).value).trim();
}

function findFleetResourceByName(name: string, resources: FleetVehiclePersonSummary[]) {
  const key = normalizeImportText(name);
  if (!key) return null;

  const exact = resources.filter((resource) => normalizeImportText(`${resource.firstName} ${resource.lastName}`) === key);
  if (exact.length === 1) return exact[0]!;

  const partial = resources.filter((resource) => {
    const label = normalizeImportText(`${resource.firstName} ${resource.lastName}`);
    return label.includes(key) || key.includes(label);
  });
  return partial.length === 1 ? partial[0]! : null;
}

function normalizeRegistrationNumber(value: string) {
  return value.replace(/\s+/g, '').toUpperCase();
}

function sanitizeText(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeNullableText(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeDate(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : trimmed;
}

function toUtcDate(value: string | null) {
  const source = value ?? new Date().toISOString().slice(0, 10);
  return new Date(`${source}T00:00:00.000Z`);
}

function normalizeImportText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function cellText(value: ExcelJS.CellValue | undefined) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('result' in value && value.result !== undefined && value.result !== null) return cellText(value.result);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text).join('').trim();
    }
    return '';
  }
  return String(value).trim();
}
