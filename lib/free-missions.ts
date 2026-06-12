import { ClockInStatus, ClockInType, FreeMissionStatus, Prisma, ProjectStatus, Role, type PrismaClient } from '@prisma/client';
import { BUSINESS_MANAGER_ROLES, FIELD_USER_ROLES, getBusinessManagedResourceRoles, isBusinessManagerRole } from '@/lib/field-roles';
import {
  createClockInRecord,
  getClockInGpsValidationError,
  getOpenSessionForUser,
  jsonClockInError,
  parseClockInInput,
  parseJsonBody,
  serializeOpenSessionError,
  serializeSessionStatus,
} from '@/lib/clock-in';

type AuthLikeUser = {
  id: string;
  role: Role;
};

export type FreeMissionMutationInput = {
  projectId?: unknown;
  assigneeId?: unknown;
  assigneeIds?: unknown;
  date?: unknown;
  action?: unknown;
  targetProgress?: unknown;
  targetQuantity?: unknown;
  targetUnit?: unknown;
  objectiveText?: unknown;
  plannedDurationMinutes?: unknown;
};

export const freeMissionSelect = {
  id: true,
  projectId: true,
  assigneeId: true,
  date: true,
  action: true,
  targetProgress: true,
  targetQuantity: true,
  targetUnit: true,
  objectiveText: true,
  plannedDurationMinutes: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  project: {
    select: {
      id: true,
      name: true,
      projectManagerId: true,
      status: true,
      projectManager: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
    },
  },
  assignee: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
    },
  },
  createdBy: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
    },
  },
  clockInRecords: {
    orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      userId: true,
      type: true,
      timestampLocal: true,
      latitude: true,
      longitude: true,
      accuracy: true,
      comment: true,
      status: true,
      isAutoClosed: true,
      isRegularized: true,
    },
  },
} satisfies Prisma.FreeMissionSelect;

export type FreeMissionRow = Prisma.FreeMissionGetPayload<{ select: typeof freeMissionSelect }>;

export function canReadFreeMissions(role: Role) {
  const readableRoles: readonly Role[] = [
    Role.GENERAL_SUPERVISOR,
    ...BUSINESS_MANAGER_ROLES,
    Role.PROJECT_MANAGER,
    Role.DIRECTION,
    Role.ADMIN,
    ...FIELD_USER_ROLES,
  ];
  return readableRoles.includes(role);
}

export function canMutateFreeMissions(role: Role) {
  const mutableRoles: readonly Role[] = [Role.GENERAL_SUPERVISOR, ...BUSINESS_MANAGER_ROLES, Role.PROJECT_MANAGER];
  return mutableRoles.includes(role);
}

export function parseFreeMissionInput(body: unknown) {
  if (!body || typeof body !== 'object') return null;
  const input = body as Record<string, unknown>;
  const projectId = sanitizeString(input.projectId);
  const assigneeIds = parseFreeMissionAssigneeIds(body);
  const assigneeId = sanitizeString(input.assigneeId) ?? assigneeIds[0];
  const date = sanitizeDate(input.date);
  const action = sanitizeString(input.action);
  const targetQuantity = parseNullablePositiveNumber(input.targetQuantity);
  const targetProgress =
    targetQuantity !== null && targetQuantity > 0 ? null : parseNullableInt(input.targetProgress, 0, 100);
  const targetUnit = targetQuantity !== null && targetQuantity > 0 ? sanitizeOptionalString(input.targetUnit) : null;
  const objectiveText = sanitizeOptionalString(input.objectiveText);
  const plannedDurationMinutes = parseNullableInt(input.plannedDurationMinutes, 0, 24 * 60);

  if (!projectId || !assigneeId || !date || !action) return null;

  return {
    projectId,
    assigneeId,
    date,
    action,
    targetProgress,
    targetQuantity,
    targetUnit,
    objectiveText,
    plannedDurationMinutes,
  };
}

function parseFreeMissionAssigneeIds(body: unknown) {
  if (!body || typeof body !== 'object') return [];
  const input = body as Record<string, unknown>;
  const rawIds = Array.isArray(input.assigneeIds) && input.assigneeIds.length > 0 ? input.assigneeIds : [input.assigneeId];
  return [...new Set(rawIds.map((id) => sanitizeString(id)).filter((id): id is string => Boolean(id)))];
}

export async function listFreeMissions(prisma: PrismaClient, user: AuthLikeUser, dateLabel: string) {
  const date = sanitizeDate(dateLabel) ?? new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');

  const rows = await prisma.freeMission.findMany({
    where: {
      date,
      deletedAt: null,
      ...freeMissionScopeWhere(user),
    },
    orderBy: [{ project: { name: 'asc' } }, { assignee: { firstName: 'asc' } }, { id: 'asc' }],
    select: freeMissionSelect,
  });

  return {
    date: date.toISOString().slice(0, 10),
    missions: rows.map(serializeFreeMission),
  };
}

export async function listMyFreeMissions(prisma: PrismaClient, user: AuthLikeUser, dateLabel?: string | null) {
  const date = sanitizeDate(dateLabel) ?? new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const rows = await prisma.freeMission.findMany({
    where: {
      date,
      assigneeId: user.id,
      deletedAt: null,
      status: { not: FreeMissionStatus.CANCELLED },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: freeMissionSelect,
  });

  return rows.map(serializeFreeMission);
}

export async function createFreeMission(prisma: PrismaClient, user: AuthLikeUser, body: unknown) {
  const input = parseFreeMissionInput(body);
  if (!input) {
    return Response.json({ code: 'BAD_REQUEST', message: 'Les donnees de mission libre sont invalides.' }, { status: 400 });
  }

  const assigneeIds = parseFreeMissionAssigneeIds(body);
  if (assigneeIds.length > 1) {
    const missions = [];
    let skippedCount = 0;

    for (const assigneeId of assigneeIds) {
      const accessError = await validateFreeMissionMutationAccess(prisma, user, input.projectId, assigneeId);
      if (accessError) return accessError;

      const existing = await prisma.freeMission.findFirst({
        where: {
          projectId: input.projectId,
          assigneeId,
          date: input.date,
          action: input.action,
          deletedAt: null,
          status: { not: FreeMissionStatus.CANCELLED },
        },
        select: { id: true },
      });

      if (existing) {
        skippedCount += 1;
        continue;
      }

      const mission = await prisma.freeMission.create({
        data: {
          projectId: input.projectId,
          assigneeId,
          date: input.date,
          action: input.action,
          targetProgress: input.targetProgress,
          targetQuantity: input.targetQuantity,
          targetUnit: input.targetUnit,
          objectiveText: input.objectiveText,
          plannedDurationMinutes: input.plannedDurationMinutes,
          createdById: user.id,
        },
        select: freeMissionSelect,
      });
      missions.push(serializeFreeMission(mission));
    }

    return Response.json(
      {
        mission: missions[0],
        missions,
        createdCount: missions.length,
        skippedCount,
      },
      { status: 201 },
    );
  }

  const accessError = await validateFreeMissionMutationAccess(prisma, user, input.projectId, input.assigneeId);
  if (accessError) return accessError;

  const existing = await prisma.freeMission.findFirst({
    where: {
      projectId: input.projectId,
      assigneeId: input.assigneeId,
      date: input.date,
      action: input.action,
      deletedAt: null,
      status: { not: FreeMissionStatus.CANCELLED },
    },
    select: { id: true },
  });

  if (existing) {
    return Response.json({ code: 'TASK_DUPLICATE', message: 'Cette mission libre existe deja pour cette ressource.' }, { status: 409 });
  }

  const mission = await prisma.freeMission.create({
    data: {
      projectId: input.projectId,
      assigneeId: input.assigneeId,
      date: input.date,
      action: input.action,
      targetProgress: input.targetProgress,
      targetQuantity: input.targetQuantity,
      targetUnit: input.targetUnit,
      objectiveText: input.objectiveText,
      plannedDurationMinutes: input.plannedDurationMinutes,
      createdById: user.id,
    },
    select: freeMissionSelect,
  });

  return Response.json({ mission: serializeFreeMission(mission) }, { status: 201 });
}

export async function updateFreeMission(prisma: PrismaClient, user: AuthLikeUser, id: string, body: unknown) {
  const existing = await getScopedFreeMission(prisma, user, id);
  if (!existing) {
    return Response.json({ code: 'NOT_FOUND', message: 'Mission libre introuvable.' }, { status: 404 });
  }

  const input = parseFreeMissionInput({
    projectId: existing.projectId,
    assigneeId: existing.assigneeId,
    date: existing.date.toISOString().slice(0, 10),
    ...(body && typeof body === 'object' ? body : {}),
  });
  if (!input) {
    return Response.json({ code: 'BAD_REQUEST', message: 'Les donnees de mission libre sont invalides.' }, { status: 400 });
  }

  const accessError = await validateFreeMissionMutationAccess(prisma, user, input.projectId, input.assigneeId);
  if (accessError) return accessError;

  const mission = await prisma.freeMission.update({
    where: { id },
    data: {
      projectId: input.projectId,
      assigneeId: input.assigneeId,
      date: input.date,
      action: input.action,
      targetProgress: input.targetProgress,
      targetQuantity: input.targetQuantity,
      targetUnit: input.targetUnit,
      objectiveText: input.objectiveText,
      plannedDurationMinutes: input.plannedDurationMinutes,
    },
    select: freeMissionSelect,
  });

  return Response.json({ mission: serializeFreeMission(mission) });
}

export async function deleteFreeMission(prisma: PrismaClient, user: AuthLikeUser, id: string) {
  const existing = await getScopedFreeMission(prisma, user, id);
  if (!existing) {
    return Response.json({ code: 'NOT_FOUND', message: 'Mission libre introuvable.' }, { status: 404 });
  }

  await prisma.freeMission.update({
    where: { id },
    data: {
      status: FreeMissionStatus.CANCELLED,
      deletedAt: new Date(),
    },
  });

  return new Response(null, { status: 204 });
}

export async function clockInFreeMission(prisma: PrismaClient, user: AuthLikeUser, missionId: string, request: Request) {
  const input = parseClockInInput(await parseJsonBody<unknown>(request));
  if (!input) {
    return jsonClockInError('BAD_REQUEST', 400, 'Le payload de pointage est invalide.');
  }

  const gpsValidationError = getClockInGpsValidationError(input);
  if (gpsValidationError) {
    return jsonClockInError('GPS_SPOOFING_SUSPECTED', 400, gpsValidationError);
  }

  const mission = await getAccessibleFreeMissionForClockIn(prisma, missionId, user.id);
  if (!mission) {
    return jsonClockInError('PERMISSION_DENIED', 403, 'Mission libre non accessible pour ce pointage.');
  }

  const openSession = await getOpenSessionForUser(prisma, user.id);
  const closingCurrentMissionSession =
    input.type !== ClockInType.ARRIVAL && openSession?.freeMissionId === mission.id;

  if (
    !closingCurrentMissionSession &&
    (mission.project.status === ProjectStatus.ARCHIVED ||
      mission.project.status === ProjectStatus.COMPLETED)
  ) {
    return jsonClockInError('PERMISSION_DENIED', 400, 'Le projet de cette zone est inactif.');
  }

  if (input.type === ClockInType.ARRIVAL && openSession) {
    return jsonClockInError('SESSION_ALREADY_OPEN', 409, 'Une session de pointage est deja ouverte.', {
      openSession: serializeOpenSessionError(openSession),
    });
  }

  if (input.type !== ClockInType.ARRIVAL && openSession?.freeMissionId !== mission.id) {
    return jsonClockInError('NO_OPEN_SESSION', 400, 'Aucune session mission libre ouverte.');
  }

  const record = await createClockInRecord(prisma, {
    freeMissionId: mission.id,
    userId: user.id,
    input,
    distanceKm: 0,
    status: ClockInStatus.VALID,
  });

  await prisma.freeMission.update({
    where: { id: mission.id },
    data: {
      status: input.type === ClockInType.DEPARTURE ? FreeMissionStatus.COMPLETED : FreeMissionStatus.IN_PROGRESS,
    },
  });

  return Response.json({ record });
}

export async function getFreeMissionSessionStatus(prisma: PrismaClient, user: AuthLikeUser, missionId: string) {
  const mission = await getAccessibleFreeMissionForClockIn(prisma, missionId, user.id);
  if (!mission) {
    return jsonClockInError('PERMISSION_DENIED', 403, 'Mission libre non accessible.');
  }

  const openSession = await getOpenSessionForUser(prisma, user.id);
  return Response.json(serializeSessionStatus(openSession?.freeMissionId === mission.id ? openSession : null, null));
}

export function serializeFreeMission(row: FreeMissionRow) {
  const latest = row.clockInRecords.at(-1) ?? null;
  const arrival = row.clockInRecords.find((record) => record.type === ClockInType.ARRIVAL && record.status === ClockInStatus.VALID) ?? null;
  const departure = [...row.clockInRecords].reverse().find((record) => record.type === ClockInType.DEPARTURE && record.status === ClockInStatus.VALID) ?? null;

  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.project.name,
    projectManagerId: row.project.projectManagerId,
    projectManagerName: `${row.project.projectManager.firstName} ${row.project.projectManager.lastName}`.trim(),
    assigneeId: row.assigneeId,
    assigneeFirstName: row.assignee.firstName,
    assigneeLastName: row.assignee.lastName,
    assigneeName: `${row.assignee.firstName} ${row.assignee.lastName}`.trim(),
    assigneeRole: row.assignee.role,
    date: row.date.toISOString().slice(0, 10),
    action: row.action,
    targetProgress: row.targetProgress,
    targetQuantity: row.targetQuantity?.toNumber() ?? null,
    targetUnit: row.targetUnit,
    objectiveText: row.objectiveText,
    plannedDurationMinutes: row.plannedDurationMinutes,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    latestClockInAt: latest?.timestampLocal.toISOString() ?? null,
    gpsPointage: buildGpsPointage(arrival, departure),
    createdBy: {
      id: row.createdBy.id,
      firstName: row.createdBy.firstName,
      lastName: row.createdBy.lastName,
      role: row.createdBy.role,
    },
  };
}

export function buildGpsPointage(
  arrival: Pick<FreeMissionRow['clockInRecords'][number], 'latitude' | 'longitude' | 'accuracy' | 'timestampLocal' | 'comment'> | null,
  departure: Pick<FreeMissionRow['clockInRecords'][number], 'latitude' | 'longitude' | 'accuracy' | 'timestampLocal' | 'comment'> | null,
) {
  if (!arrival && !departure) return null;

  return {
    arrival: arrival
      ? {
          latitude: arrival.latitude.toNumber(),
          longitude: arrival.longitude.toNumber(),
          accuracy: arrival.accuracy?.toNumber() ?? null,
          timestampLocal: arrival.timestampLocal.toISOString(),
          comment: arrival.comment,
        }
      : null,
    departure: departure
      ? {
          latitude: departure.latitude.toNumber(),
          longitude: departure.longitude.toNumber(),
          accuracy: departure.accuracy?.toNumber() ?? null,
          timestampLocal: departure.timestampLocal.toISOString(),
          comment: departure.comment,
        }
      : null,
  };
}

function getScopedFreeMission(prisma: PrismaClient, user: AuthLikeUser, id: string) {
  return prisma.freeMission.findFirst({
    where: {
      id,
      deletedAt: null,
      ...freeMissionScopeWhere(user),
    },
    select: freeMissionSelect,
  });
}

function getAccessibleFreeMissionForClockIn(prisma: PrismaClient, missionId: string, userId: string) {
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  return prisma.freeMission.findFirst({
    where: {
      id: missionId,
      assigneeId: userId,
      deletedAt: null,
      status: { not: FreeMissionStatus.CANCELLED },
      OR: [
        { date: today },
        {
          clockInRecords: {
            some: {
              userId,
              status: ClockInStatus.VALID,
              isAutoClosed: false,
              type: ClockInType.ARRIVAL,
            },
          },
        },
      ],
    },
    select: freeMissionSelect,
  });
}

async function validateFreeMissionMutationAccess(
  prisma: PrismaClient,
  user: AuthLikeUser,
  projectId: string,
  assigneeId: string,
) {
  if (!canMutateFreeMissions(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Creation de mission libre non autorisee.' }, { status: 403 });
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      status: { notIn: [ProjectStatus.ARCHIVED, ProjectStatus.COMPLETED] },
      ...(user.role === Role.PROJECT_MANAGER ? { projectManagerId: user.id } : {}),
    },
    select: { id: true },
  });

  if (!project) {
    return Response.json({ code: 'PROJECT_NOT_FOUND', message: 'Projet actif introuvable ou non accessible.' }, { status: 404 });
  }

  const resourceRoles = isBusinessManagerRole(user.role) ? getBusinessManagedResourceRoles(user.role) : FIELD_USER_ROLES;
  const assignee = await prisma.user.findFirst({
    where: {
      id: assigneeId,
      isActive: true,
      role: { in: [...resourceRoles] },
    },
    select: { id: true },
  });

  if (!assignee) {
    return Response.json({ code: 'RESOURCE_NOT_FOUND', message: 'Ressource active non assignable pour cette mission libre.' }, { status: 404 });
  }

  return null;
}

function freeMissionScopeWhere(user: AuthLikeUser): Prisma.FreeMissionWhereInput {
  if (FIELD_USER_ROLES.includes(user.role)) {
    return { assigneeId: user.id };
  }

  if (user.role === Role.PROJECT_MANAGER) {
    return { project: { projectManagerId: user.id } };
  }

  if (BUSINESS_MANAGER_ROLES.includes(user.role as (typeof BUSINESS_MANAGER_ROLES)[number])) {
    const businessManagerRole = user.role as (typeof BUSINESS_MANAGER_ROLES)[number];
    return { assignee: { role: { in: [...getBusinessManagedResourceRoles(businessManagerRole)] } } };
  }

  if (user.role === Role.DIRECTION || user.role === Role.ADMIN) {
    return {};
  }

  if (user.role === Role.GENERAL_SUPERVISOR) {
    return { createdById: user.id };
  }

  return { id: '__none__' };
}

function sanitizeString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function sanitizeOptionalString(value: unknown) {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value.trim() || null : null;
}

function parseNullablePositiveNumber(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) return null;
  return numberValue;
}

function parseNullableInt(value: unknown, min: number, max: number) {
  if (value === undefined || value === null || value === '') return null;
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < min || numberValue > max) return null;
  return numberValue;
}

function sanitizeDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
