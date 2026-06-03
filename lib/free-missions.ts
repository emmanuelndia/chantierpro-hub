import { ClockInStatus, ClockInType, FreeMissionStatus, Prisma, ProjectStatus, Role, type PrismaClient } from '@prisma/client';
import { BUSINESS_MANAGER_ROLES, FIELD_USER_ROLES, getBusinessManagedResourceRoles, isBusinessManagerRole } from '@/lib/field-roles';
import {
  createClockInRecord,
  getClockInGpsValidationError,
  getOpenSessionForUser,
  jsonClockInError,
  parseClockInInput,
  parseJsonBody,
  serializeSessionStatus,
} from '@/lib/clock-in';

type AuthLikeUser = {
  id: string;
  role: Role;
};

export type FreeMissionMutationInput = {
  projectId?: unknown;
  assigneeId?: unknown;
  date?: unknown;
  action?: unknown;
  objectiveText?: unknown;
};

export const freeMissionSelect = {
  id: true,
  projectId: true,
  assigneeId: true,
  date: true,
  action: true,
  objectiveText: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  project: {
    select: {
      id: true,
      name: true,
      projectManagerId: true,
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
  const assigneeId = sanitizeString(input.assigneeId);
  const date = sanitizeDate(input.date);
  const action = sanitizeString(input.action);
  const objectiveText = sanitizeOptionalString(input.objectiveText);

  if (!projectId || !assigneeId || !date || !action) return null;

  return {
    projectId,
    assigneeId,
    date,
    action,
    objectiveText,
  };
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

  const accessError = await validateFreeMissionMutationAccess(prisma, user, input.projectId, input.assigneeId);
  if (accessError) return accessError;

  const mission = await prisma.freeMission.create({
    data: {
      projectId: input.projectId,
      assigneeId: input.assigneeId,
      date: input.date,
      action: input.action,
      objectiveText: input.objectiveText,
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
      objectiveText: input.objectiveText,
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
  if (input.type === ClockInType.ARRIVAL && openSession) {
    return jsonClockInError('SESSION_ALREADY_OPEN', 409, 'Une session de pointage est deja ouverte.');
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
    assigneeId: row.assigneeId,
    assigneeFirstName: row.assignee.firstName,
    assigneeLastName: row.assignee.lastName,
    assigneeName: `${row.assignee.firstName} ${row.assignee.lastName}`.trim(),
    assigneeRole: row.assignee.role,
    date: row.date.toISOString().slice(0, 10),
    action: row.action,
    objectiveText: row.objectiveText,
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
      date: today,
      deletedAt: null,
      status: { not: FreeMissionStatus.CANCELLED },
      project: {
        status: { notIn: [ProjectStatus.ARCHIVED, ProjectStatus.COMPLETED] },
      },
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

function sanitizeDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
