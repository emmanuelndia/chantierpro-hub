import { NegotiationAssignmentStatus, NegotiationSessionStatus, NegotiationVisitStatus, ProjectStatus, Role, type PrismaClient } from '@prisma/client';
import type { RequestAuthUser } from '@/lib/auth/request-user';

type UserOptionRow = { id: string; firstName: string; lastName: string; role: Role; username: string };
type ProjectOptionRow = { id: string; name: string; city?: string | null };
type SessionVisitRow = {
  id: string;
  buildingName: string;
  actualZone: string | null;
  status: NegotiationVisitStatus;
  remark: string;
  visitedAt: Date;
  latitude: unknown;
  longitude: unknown;
};
type NegotiationSessionRow = {
  id: string;
  assignmentId: string | null;
  projectId: string;
  project?: ProjectOptionRow | null;
  user?: UserOptionRow | null;
  date: Date;
  startTime: Date;
  startLatitude: unknown;
  startLongitude: unknown;
  startAccuracy: unknown;
  endTime: Date | null;
  endLatitude: unknown;
  endLongitude: unknown;
  endAccuracy: unknown;
  comment: string | null;
  status: NegotiationSessionStatus;
  assignment?: { id: string; plannedZone: string | null; instruction: string | null } | null;
  visits?: SessionVisitRow[];
};
type NegotiationVisitRow = {
  id: string;
  sessionId: string;
  projectId: string;
  project?: { id: string; name: string } | null;
  session?: { user?: { firstName: string; lastName: string } | null } | null;
  buildingId: string | null;
  building?: { id: string; cluster: string | null; plaque: string | null } | null;
  visitedAt: Date;
  actualZone: string | null;
  buildingName: string;
  city: string | null;
  commune: string | null;
  contactInfo: string | null;
  latitude: unknown;
  longitude: unknown;
  accuracy: unknown;
  status: NegotiationVisitStatus;
  remark: string;
};

export const NEGOTIATION_ACCESS_ROLES: readonly Role[] = [
  Role.NEGOTIATION_MANAGER,
  Role.NEGOTIATION_RESOURCE,
  Role.DIRECTION,
  Role.ADMIN,
];

export const NEGOTIATION_FIELD_ROLES: readonly Role[] = [Role.NEGOTIATION_RESOURCE, Role.NEGOTIATION_MANAGER];

export function canAccessNegotiation(role: Role) {
  return NEGOTIATION_ACCESS_ROLES.includes(role);
}

export function canManageNegotiation(role: Role) {
  return role === Role.NEGOTIATION_MANAGER || role === Role.DIRECTION || role === Role.ADMIN;
}

export function canUseNegotiationField(role: Role) {
  return NEGOTIATION_FIELD_ROLES.includes(role);
}

export function negotiationProjectWhere(user: RequestAuthUser) {
  const activeStatus = { notIn: [ProjectStatus.ARCHIVED, ProjectStatus.COMPLETED] };

  if (user.role === Role.NEGOTIATION_MANAGER || user.role === Role.NEGOTIATION_RESOURCE) {
    return { status: activeStatus };
  }

  if (user.role === Role.DIRECTION || user.role === Role.ADMIN) {
    return { status: activeStatus };
  }

  return { id: '__forbidden__' };
}

export async function listNegotiationOverview(
  prisma: PrismaClient,
  user: RequestAuthUser,
  date: string,
  filters: { projectId?: string; resourceId?: string; status?: string; q?: string } = {},
) {
  const dateValue = parseDateOnly(date);
  const projectWhere = negotiationProjectWhere(user);
  const projectFilter = filters.projectId ? { id: filters.projectId, ...projectWhere } : projectWhere;
  const resources = await prisma.user.findMany({
    where: {
      role: { in: [...NEGOTIATION_FIELD_ROLES] },
      isActive: true,
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    select: { id: true, firstName: true, lastName: true, role: true, username: true },
  });
  const projects = await prisma.project.findMany({
    where: projectWhere,
    orderBy: { name: 'asc' },
    select: { id: true, name: true, city: true, status: true },
  });

  const assignments = await prisma.negotiationAssignment.findMany({
    where: {
      date: dateValue,
      deletedAt: null,
      ...(filters.resourceId ? { assigneeId: filters.resourceId } : {}),
      project: projectFilter,
    },
    include: {
      project: { select: { id: true, name: true, city: true } },
      assignee: { select: { id: true, firstName: true, lastName: true, role: true, username: true } },
      sessions: {
        where: { date: dateValue },
        include: {
          visits: true,
        },
      },
    },
    orderBy: [{ project: { name: 'asc' } }, { assignee: { firstName: 'asc' } }],
  });

  const sessions = await prisma.negotiationSession.findMany({
    where: {
      date: dateValue,
      ...(filters.resourceId ? { userId: filters.resourceId } : {}),
      project: projectFilter,
    },
    include: {
      project: { select: { id: true, name: true, city: true } },
      user: { select: { id: true, firstName: true, lastName: true, role: true, username: true } },
      assignment: { select: { id: true, plannedZone: true, instruction: true } },
      visits: true,
    },
    orderBy: [{ startTime: 'desc' }],
  });

  const visits = await prisma.negotiationVisit.findMany({
    where: {
      session: { date: dateValue },
      ...(filters.status ? { status: filters.status as NegotiationVisitStatus } : {}),
      project: projectFilter,
      ...(filters.q
        ? {
            OR: [
              { buildingName: { contains: filters.q, mode: 'insensitive' } },
              { city: { contains: filters.q, mode: 'insensitive' } },
              { commune: { contains: filters.q, mode: 'insensitive' } },
              { remark: { contains: filters.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include: {
      project: { select: { id: true, name: true } },
      session: { select: { id: true, userId: true, date: true, user: { select: { firstName: true, lastName: true } } } },
      building: { select: { id: true, cluster: true, plaque: true } },
    },
    orderBy: { visitedAt: 'desc' },
    take: 200,
  });

  const buildingCount = await prisma.negotiationBuilding.count({ where: { project: projectWhere } });
  const projectScopeSummaries = await buildProjectScopeSummaries(prisma, projects.map((project) => project.id));

  return {
    date,
    projects,
    resources: resources.map(serializeUserOption),
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      project: assignment.project,
      assignee: serializeUserOption(assignment.assignee),
      date: formatDateOnly(assignment.date),
      plannedZone: assignment.plannedZone,
      instruction: assignment.instruction,
      status: assignment.status,
      sessionCount: assignment.sessions.length,
      visitCount: assignment.sessions.reduce((total, session) => total + session.visits.length, 0),
    })),
    sessions: sessions.map(serializeNegotiationSession),
    visits: visits.map(serializeNegotiationVisit),
    buildingCount,
    projectScopeSummaries,
    visitStatuses: Object.values(NegotiationVisitStatus),
  };
}

export async function createNegotiationAssignment(prisma: PrismaClient, user: RequestAuthUser, body: unknown) {
  if (!canManageNegotiation(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces refuse a la planification negociation.' }, { status: 403 });
  }

  const input = parseAssignmentInput(body);
  if (!input.ok) {
    return Response.json({ code: 'BAD_REQUEST', message: input.message }, { status: 400 });
  }

  const project = await prisma.project.findFirst({ where: { id: input.data.projectId, ...negotiationProjectWhere(user) }, select: { id: true } });
  if (!project) {
    return Response.json({ code: 'PROJECT_NOT_FOUND', message: 'Projet negociation introuvable ou inactif.' }, { status: 404 });
  }

  const assignees = await prisma.user.findMany({
    where: { id: { in: input.data.assigneeIds }, role: { in: [...NEGOTIATION_FIELD_ROLES] }, isActive: true },
    select: { id: true },
  });

  if (assignees.length === 0) {
    return Response.json({ code: 'ASSIGNEE_NOT_FOUND', message: 'Aucune ressource negociation active selectionnee.' }, { status: 400 });
  }

  const date = parseDateOnly(input.data.date);
  const existing = await prisma.negotiationAssignment.findMany({
    where: {
      projectId: input.data.projectId,
      date,
      assigneeId: { in: assignees.map((assignee) => assignee.id) },
      deletedAt: null,
    },
    select: { assigneeId: true },
  });
  const existingIds = new Set(existing.map((item) => item.assigneeId));
  const creatableIds = assignees.map((assignee) => assignee.id).filter((id) => !existingIds.has(id));

  if (creatableIds.length > 0) {
    await prisma.negotiationAssignment.createMany({
      data: creatableIds.map((assigneeId) => ({
        projectId: input.data.projectId,
        assigneeId,
        date,
        plannedZone: input.data.plannedZone,
        instruction: input.data.instruction,
        createdById: user.id,
      })),
    });
  }

  return Response.json({
    createdCount: creatableIds.length,
    skippedCount: assignees.length - creatableIds.length,
  });
}

export async function getMobileNegotiationDay(prisma: PrismaClient, user: RequestAuthUser, date: string) {
  if (!canUseNegotiationField(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces mobile negociation refuse.' }, { status: 403 });
  }

  const dateValue = parseDateOnly(date);
  const assignments = await prisma.negotiationAssignment.findMany({
    where: { date: dateValue, assigneeId: user.id, deletedAt: null },
    include: { project: { select: { id: true, name: true, city: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const openSession = await prisma.negotiationSession.findFirst({
    where: { userId: user.id, date: dateValue, status: NegotiationSessionStatus.OPEN },
    include: {
      project: { select: { id: true, name: true } },
      assignment: { select: { id: true, plannedZone: true, instruction: true } },
      visits: { orderBy: { visitedAt: 'desc' } },
    },
    orderBy: { startTime: 'desc' },
  });
  const todaySessions = await prisma.negotiationSession.findMany({
    where: { userId: user.id, date: dateValue },
    include: { visits: { orderBy: { visitedAt: 'desc' } }, project: { select: { id: true, name: true } } },
    orderBy: { startTime: 'desc' },
  });

  return {
    date,
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      project: assignment.project,
      plannedZone: assignment.plannedZone,
      instruction: assignment.instruction,
      status: assignment.status,
    })),
    openSession: openSession ? serializeNegotiationSession(openSession) : null,
    sessions: todaySessions.map(serializeNegotiationSession),
    visitStatuses: Object.values(NegotiationVisitStatus),
  };
}

export async function startNegotiationSession(prisma: PrismaClient, user: RequestAuthUser, body: unknown) {
  if (!canUseNegotiationField(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const input = parseStartSessionInput(body);
  if (!input.ok) {
    return Response.json({ code: 'BAD_REQUEST', message: input.message }, { status: 400 });
  }

  const date = parseDateOnly(input.data.date);
  const existingOpen = await prisma.negotiationSession.findFirst({
    where: { userId: user.id, date, status: NegotiationSessionStatus.OPEN },
    select: { id: true },
  });
  if (existingOpen) {
    return Response.json({ code: 'OPEN_SESSION_EXISTS', message: 'Une journee negociation est deja ouverte.' }, { status: 409 });
  }

  const assignment = input.data.assignmentId
    ? await prisma.negotiationAssignment.findFirst({
        where: { id: input.data.assignmentId, assigneeId: user.id, date, deletedAt: null },
        select: { id: true, projectId: true },
      })
    : null;

  if (input.data.assignmentId && !assignment) {
    return Response.json({ code: 'ASSIGNMENT_NOT_FOUND', message: 'Mission negociation introuvable.' }, { status: 404 });
  }

  const projectId = assignment?.projectId ?? input.data.projectId;
  if (!projectId) {
    return Response.json({ code: 'PROJECT_REQUIRED', message: 'Selectionne un projet pour demarrer la journee.' }, { status: 400 });
  }

  const session = await prisma.negotiationSession.create({
    data: {
      assignmentId: assignment?.id ?? null,
      projectId,
      userId: user.id,
      date,
      startTime: new Date(),
      startLatitude: input.data.latitude,
      startLongitude: input.data.longitude,
      startAccuracy: input.data.accuracy,
      comment: input.data.comment,
      status: NegotiationSessionStatus.OPEN,
    },
    include: { project: { select: { id: true, name: true } }, assignment: { select: { id: true, plannedZone: true, instruction: true } }, visits: true },
  });

  if (assignment?.id) {
    await prisma.negotiationAssignment.update({
      where: { id: assignment.id },
      data: { status: NegotiationAssignmentStatus.IN_PROGRESS },
    });
  }

  return Response.json({ session: serializeNegotiationSession(session) });
}

export async function closeNegotiationSession(prisma: PrismaClient, user: RequestAuthUser, sessionId: string, body: unknown) {
  const input = parseCloseSessionInput(body);
  if (!input.ok) {
    return Response.json({ code: 'BAD_REQUEST', message: input.message }, { status: 400 });
  }

  const session = await prisma.negotiationSession.findFirst({
    where: { id: sessionId, userId: user.id, status: NegotiationSessionStatus.OPEN },
    select: { id: true, assignmentId: true },
  });
  if (!session) {
    return Response.json({ code: 'SESSION_NOT_FOUND', message: 'Session negociation ouverte introuvable.' }, { status: 404 });
  }

  const updated = await prisma.negotiationSession.update({
    where: { id: session.id },
    data: {
      endTime: new Date(),
      endLatitude: input.data.latitude,
      endLongitude: input.data.longitude,
      endAccuracy: input.data.accuracy,
      comment: input.data.comment,
      status: NegotiationSessionStatus.CLOSED,
    },
    include: { project: { select: { id: true, name: true } }, assignment: { select: { id: true, plannedZone: true, instruction: true } }, visits: true },
  });

  if (session.assignmentId) {
    await prisma.negotiationAssignment.update({
      where: { id: session.assignmentId },
      data: { status: NegotiationAssignmentStatus.COMPLETED },
    });
  }

  return Response.json({ session: serializeNegotiationSession(updated) });
}

export async function createNegotiationVisit(prisma: PrismaClient, user: RequestAuthUser, body: unknown) {
  if (!canUseNegotiationField(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const input = parseVisitInput(body);
  if (!input.ok) {
    return Response.json({ code: 'BAD_REQUEST', message: input.message }, { status: 400 });
  }

  const session = await prisma.negotiationSession.findFirst({
    where: { id: input.data.sessionId, userId: user.id, status: NegotiationSessionStatus.OPEN },
    select: { id: true, projectId: true },
  });
  if (!session) {
    return Response.json({ code: 'SESSION_NOT_FOUND', message: 'Demarre une journee negociation avant de saisir une visite.' }, { status: 404 });
  }

  const visit = await prisma.$transaction(async (tx) => {
    const existingScope = input.data.buildingId
      ? await tx.negotiationBuilding.findFirst({ where: { id: input.data.buildingId, projectId: session.projectId } })
      : null;
    const scope = existingScope ?? await tx.negotiationBuilding.create({
      data: {
        projectId: session.projectId,
        name: input.data.buildingName || 'Scope terrain',
        city: input.data.city ?? input.data.actualZone ?? 'Non renseigne',
        commune: input.data.commune,
        contactInfo: input.data.contactInfo,
        latitude: input.data.latitude,
        longitude: input.data.longitude,
        negotiationStatus: input.data.status,
        remark: input.data.remark,
      },
    });

    if (existingScope) {
      await tx.negotiationBuilding.update({
        where: { id: existingScope.id },
        data: {
          negotiationStatus: input.data.status,
          remark: input.data.remark,
          ...(input.data.contactInfo ? { contactInfo: input.data.contactInfo } : {}),
          ...(input.data.latitude !== null && existingScope.latitude === null ? { latitude: input.data.latitude } : {}),
          ...(input.data.longitude !== null && existingScope.longitude === null ? { longitude: input.data.longitude } : {}),
        },
      });
    }

    return tx.negotiationVisit.create({
      data: {
        sessionId: session.id,
        projectId: session.projectId,
        buildingId: scope.id,
        actualZone: input.data.actualZone,
        buildingName: input.data.buildingName ? input.data.buildingName : scope.name,
        city: input.data.city ?? scope.city ?? null,
        commune: input.data.commune ?? scope.commune ?? null,
        contactInfo: input.data.contactInfo ?? scope.contactInfo ?? null,
        latitude: input.data.latitude ?? scope.latitude ?? null,
        longitude: input.data.longitude ?? scope.longitude ?? null,
        accuracy: input.data.accuracy,
        status: input.data.status,
        remark: input.data.remark,
        createdById: user.id,
      },
      include: {
        project: { select: { id: true, name: true } },
        session: { select: { id: true, userId: true, date: true, user: { select: { firstName: true, lastName: true } } } },
        building: { select: { id: true, cluster: true, plaque: true } },
      },
    });
  });

  return Response.json({ visit: serializeNegotiationVisit(visit) });
}

export async function searchNegotiationBuildings(prisma: PrismaClient, user: RequestAuthUser, projectId: string, q: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, ...negotiationProjectWhere(user) }, select: { id: true } });
  if (!project) {
    return Response.json({ code: 'PROJECT_NOT_FOUND' }, { status: 404 });
  }

  const buildings = await prisma.negotiationBuilding.findMany({
    where: {
      projectId,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { city: { contains: q, mode: 'insensitive' } },
              { commune: { contains: q, mode: 'insensitive' } },
              { contactInfo: { contains: q, mode: 'insensitive' } },
              { negotiationStatus: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: [{ city: 'asc' }, { name: 'asc' }],
    take: 30,
  });

  return Response.json({ buildings: buildings.map(serializeNegotiationBuilding) });
}

function parseAssignmentInput(body: unknown) {
  const data = asRecord(body);
  const projectId = asString(data.projectId);
  const assigneeIds = Array.isArray(data.assigneeIds)
    ? data.assigneeIds.map(asString).filter(Boolean)
    : [asString(data.assigneeId)].filter(Boolean);
  const date = asString(data.date);

  if (!projectId || assigneeIds.length === 0 || !isDateKey(date)) {
    return { ok: false as const, message: 'Projet, ressource et date sont obligatoires.' };
  }

  return {
    ok: true as const,
    data: {
      projectId,
      assigneeIds,
      date,
      plannedZone: nullableString(data.plannedZone),
      instruction: nullableString(data.instruction),
    },
  };
}

function parseStartSessionInput(body: unknown) {
  const data = asRecord(body);
  const date = asString(data.date);
  const latitude = asNumber(data.latitude);
  const longitude = asNumber(data.longitude);

  if (!isDateKey(date) || latitude === null || longitude === null) {
    return { ok: false as const, message: 'Date et position GPS sont obligatoires.' };
  }

  return {
    ok: true as const,
    data: {
      date,
      assignmentId: nullableString(data.assignmentId),
      projectId: nullableString(data.projectId),
      latitude,
      longitude,
      accuracy: asNumber(data.accuracy),
      comment: nullableString(data.comment),
    },
  };
}

function parseCloseSessionInput(body: unknown) {
  const data = asRecord(body);
  const latitude = asNumber(data.latitude);
  const longitude = asNumber(data.longitude);

  if (latitude === null || longitude === null) {
    return { ok: false as const, message: 'Position GPS de sortie obligatoire.' };
  }

  return {
    ok: true as const,
    data: {
      latitude,
      longitude,
      accuracy: asNumber(data.accuracy),
      comment: nullableString(data.comment),
    },
  };
}

function parseVisitInput(body: unknown) {
  const data = asRecord(body);
  const sessionId = asString(data.sessionId);
  const status = asString(data.status) as NegotiationVisitStatus;
  const remark = asString(data.remark);

  if (!sessionId || !Object.values(NegotiationVisitStatus).includes(status) || !remark.trim()) {
    return { ok: false as const, message: 'Session, statut et remarque sont obligatoires.' };
  }

  return {
    ok: true as const,
    data: {
      sessionId,
      buildingId: nullableString(data.buildingId),
      actualZone: nullableString(data.actualZone),
      buildingName: asString(data.buildingName),
      city: nullableString(data.city),
      commune: nullableString(data.commune),
      contactInfo: nullableString(data.contactInfo),
      latitude: asNumber(data.latitude),
      longitude: asNumber(data.longitude),
      accuracy: asNumber(data.accuracy),
      status,
      remark,
    },
  };
}

export function serializeNegotiationBuilding(building: {
  id: string;
  projectId: string;
  cluster: string | null;
  city: string;
  commune: string | null;
  plaque: string | null;
  name: string;
  contactInfo: string | null;
  level: string | null;
  targetEl: number | null;
  actualEl: number | null;
  longitude: unknown;
  latitude: unknown;
  operatorPresence: string | null;
  negotiationStatus: string | null;
  remark: string | null;
}) {
  return {
    ...building,
    longitude: decimalToNumber(building.longitude),
    latitude: decimalToNumber(building.latitude),
  };
}

export function serializeNegotiationSession(session: NegotiationSessionRow) {
  return {
    id: session.id,
    assignmentId: session.assignmentId,
    projectId: session.projectId,
    project: session.project ?? null,
    user: session.user ? serializeUserOption(session.user) : null,
    date: formatDateOnly(session.date),
    startTime: session.startTime?.toISOString?.() ?? session.startTime,
    startLatitude: decimalToNumber(session.startLatitude),
    startLongitude: decimalToNumber(session.startLongitude),
    startAccuracy: decimalToNumber(session.startAccuracy),
    endTime: session.endTime?.toISOString?.() ?? null,
    endLatitude: decimalToNumber(session.endLatitude),
    endLongitude: decimalToNumber(session.endLongitude),
    endAccuracy: decimalToNumber(session.endAccuracy),
    comment: session.comment,
    status: session.status,
    assignment: session.assignment ?? null,
    visits: (session.visits ?? []).map((visit) => ({
      id: visit.id,
      buildingName: visit.buildingName,
      actualZone: visit.actualZone,
      status: visit.status,
      remark: visit.remark,
      visitedAt: visit.visitedAt?.toISOString?.() ?? visit.visitedAt,
      latitude: decimalToNumber(visit.latitude),
      longitude: decimalToNumber(visit.longitude),
    })),
    visitCount: session.visits?.length ?? 0,
  };
}

export function serializeNegotiationVisit(visit: NegotiationVisitRow) {
  return {
    id: visit.id,
    sessionId: visit.sessionId,
    projectId: visit.projectId,
    project: visit.project ?? null,
    resourceName: visit.session?.user ? `${visit.session.user.firstName} ${visit.session.user.lastName}` : null,
    buildingId: visit.buildingId,
    building: visit.building ?? null,
    visitedAt: visit.visitedAt?.toISOString?.() ?? visit.visitedAt,
    actualZone: visit.actualZone,
    buildingName: visit.buildingName,
    city: visit.city,
    commune: visit.commune,
    contactInfo: visit.contactInfo,
    latitude: decimalToNumber(visit.latitude),
    longitude: decimalToNumber(visit.longitude),
    accuracy: decimalToNumber(visit.accuracy),
    status: visit.status,
    remark: visit.remark,
  };
}

async function buildProjectScopeSummaries(prisma: PrismaClient, projectIds: string[]) {
  if (projectIds.length === 0) return [];

  const scopes = await prisma.negotiationBuilding.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true, projectId: true, negotiationStatus: true },
  });
  const summaries = new Map<string, {
    projectId: string;
    totalScopes: number;
    authorized: number;
    refused: number;
    revisit: number;
    inProgress: number;
    untreated: number;
  }>();

  for (const projectId of projectIds) {
    summaries.set(projectId, {
      projectId,
      totalScopes: 0,
      authorized: 0,
      refused: 0,
      revisit: 0,
      inProgress: 0,
      untreated: 0,
    });
  }

  for (const scope of scopes) {
    const summary = summaries.get(scope.projectId);
    if (!summary) continue;
    summary.totalScopes += 1;
    const status = normalizeScopeStatus(scope.negotiationStatus);
    if (status === 'authorized') summary.authorized += 1;
    else if (status === 'refused') summary.refused += 1;
    else if (status === 'revisit') summary.revisit += 1;
    else if (status === 'inProgress') summary.inProgress += 1;
    else summary.untreated += 1;
  }

  return [...summaries.values()].map((summary) => ({
    ...summary,
    processed: summary.authorized + summary.refused + summary.revisit + summary.inProgress,
    treatmentRate: summary.totalScopes > 0 ? Math.round(((summary.authorized + summary.refused + summary.revisit + summary.inProgress) / summary.totalScopes) * 100) : 0,
    authorizationRate: summary.totalScopes > 0 ? Math.round((summary.authorized / summary.totalScopes) * 100) : 0,
  }));
}

function normalizeScopeStatus(value: string | null) {
  if (!value) return 'untreated';
  const normalized = value.toUpperCase();
  if (normalized === NegotiationVisitStatus.OK) return 'authorized';
  if (normalized === NegotiationVisitStatus.REFUS) return 'refused';
  if (normalized === NegotiationVisitStatus.A_REVISITER) return 'revisit';
  if (normalized === NegotiationVisitStatus.EN_COURS) return 'inProgress';
  return 'untreated';
}

function serializeUserOption(user: { id: string; firstName: string; lastName: string; role: Role; username: string }) {
  return {
    id: user.id,
    name: `${user.firstName} ${user.lastName}`,
    role: user.role,
    username: user.username,
  };
}

export function parseDateOnly(date: string) {
  return new Date(`${date}T00:00:00.000Z`);
}

export function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function nullableString(value: unknown) {
  const text = asString(value);
  return text || null;
}

function asNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function decimalToNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
