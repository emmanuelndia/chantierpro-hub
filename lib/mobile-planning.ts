import {
  ClockInStatus,
  ClockInType,
  PlanningAssignmentStatus,
  Role,
  SiteStatus,
  TeamMemberStatus,
  TeamStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import type {
  CreateAssignmentRequest,
  DuplicateAssignmentsResponse,
  PlanningAssignment,
  PlanningClockInStatus,
  PlanningDayResponse,
  UpdateAssignmentRequest,
} from '@/types/mobile-planning';

type AuthLikeUser = {
  id: string;
  role: Role;
};

type PlanningAssignmentRow = Prisma.PlanningAssignmentGetPayload<{
  select: typeof planningAssignmentSelect;
}>;

type ClockInRow = {
  siteId: string;
  userId: string;
  type: ClockInType;
  timestampLocal: Date;
  createdAt: Date;
};

export function canAccessMobilePlanning(role: Role) {
  return [
    Role.GENERAL_SUPERVISOR,
    Role.PROJECT_MANAGER,
    Role.DIRECTION,
    Role.ADMIN,
  ].includes(role);
}

export function operationalPlanningSiteWhere(user: AuthLikeUser, date?: Date): Prisma.SiteWhereInput {
  const where: Prisma.SiteWhereInput = {
    status: SiteStatus.ACTIVE,
    teams: {
      some: {
        status: TeamStatus.ACTIVE,
        members: {
          some: {
            userId: user.id,
            status: TeamMemberStatus.ACTIVE,
          },
        },
      },
    },
  };

  if (date) {
    where.startDate = { lte: date };
    where.OR = [{ endDate: null }, { endDate: { gte: date } }];
  }

  return where;
}

export async function getPlanningDay(
  prisma: PrismaClient,
  user: AuthLikeUser,
  dateValue: string,
): Promise<PlanningDayResponse | Response> {
  const parsedDate = parsePlanningDate(dateValue);
  if (!parsedDate) {
    return planningError('INVALID_DATE', 'Date invalide.', 400);
  }

  const rangeError = validateDateWindow(parsedDate);
  if (rangeError) return rangeError;

  const siteWhere = operationalPlanningSiteWhere(user, parsedDate);
  const [assignments, sites, scopedSupervisorIds] = await Promise.all([
    prisma.planningAssignment.findMany({
      where: {
        date: parsedDate,
        deletedAt: null,
        site: siteWhere,
      },
      orderBy: [
        { site: { name: 'asc' } },
        { supervisor: { firstName: 'asc' } },
        { supervisor: { lastName: 'asc' } },
        { id: 'asc' },
      ],
      select: planningAssignmentSelect,
    }),
    prisma.site.findMany({
      where: siteWhere,
      orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
      select: availableSiteSelect,
    }),
    getScopedSupervisorIds(prisma, user, parsedDate),
  ]);

  const assignedSupervisorIds = new Set(assignments.map((assignment) => assignment.supervisorId));
  const [supervisors, clockIns, yesterdayCount] = await Promise.all([
    prisma.user.findMany({
      where: {
        id: { in: scopedSupervisorIds.filter((supervisorId) => !assignedSupervisorIds.has(supervisorId)) },
        role: Role.SUPERVISOR,
        isActive: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        contact: true,
        isActive: true,
      },
    }),
    loadClockInsForAssignments(prisma, parsedDate, assignments),
    prisma.planningAssignment.count({
      where: {
        date: addDays(parsedDate, -1),
        deletedAt: null,
        site: siteWhere,
      },
    }),
  ]);

  return {
    date: formatPlanningDate(parsedDate),
    assignments: assignments.map((assignment) => serializePlanningAssignment(assignment, clockIns)),
    unassignedSupervisors: supervisors.map((supervisor) => ({
      id: supervisor.id,
      firstName: supervisor.firstName,
      name: supervisor.lastName,
      email: supervisor.email,
      contact: supervisor.contact,
      isActive: supervisor.isActive,
    })),
    availableSites: sites.map((site) => ({
      id: site.id,
      name: site.name,
      address: site.address,
      status: site.status,
      project: {
        id: site.project.id,
        name: site.project.name,
      },
    })),
    hasAssignments: assignments.length > 0,
    canDuplicateFromYesterday: assignments.length === 0 && yesterdayCount > 0,
  };
}

export async function createPlanningAssignment(
  prisma: PrismaClient,
  user: AuthLikeUser,
  input: CreateAssignmentRequest,
) {
  const normalized = await validateAssignmentInput(prisma, user, input);
  if (normalized instanceof Response) return normalized;

  const existing = await prisma.planningAssignment.findFirst({
    where: {
      date: normalized.date,
      supervisorId: normalized.supervisorId,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (existing) {
    return planningError('ASSIGNMENT_CONFLICT', 'Ce superviseur a déjà une assignation active pour cette date.', 409);
  }

  const assignment = await prisma.planningAssignment.create({
    data: {
      date: normalized.date,
      supervisorId: normalized.supervisorId,
      siteId: normalized.siteId,
      action: normalized.action,
      targetProgress: normalized.targetProgress,
      status: PlanningAssignmentStatus.ASSIGNED,
      createdById: user.id,
    },
    select: planningAssignmentSelect,
  });

  return { assignment: serializePlanningAssignment(assignment, []) };
}

export async function updatePlanningAssignment(
  prisma: PrismaClient,
  user: AuthLikeUser,
  assignmentId: string,
  input: UpdateAssignmentRequest,
) {
  const existing = await getScopedPlanningAssignment(prisma, user, assignmentId);
  if (!existing) {
    return planningError('NOT_FOUND', 'Assignation introuvable dans votre périmètre.', 404);
  }

  const action = normalizeOptionalAction(input.action);
  const targetProgress = normalizeTargetProgress(input.targetProgress);
  const status = normalizePlanningStatus(input.status);

  if (input.action !== undefined && !action) {
    return planningError('INVALID_ACTION', "L'action est requise.", 400);
  }

  if (targetProgress instanceof Response) {
    return targetProgress;
  }

  if (input.status !== undefined && !status) {
    return planningError('INVALID_STATUS', 'Statut de planning invalide.', 400);
  }

  const assignment = await prisma.planningAssignment.update({
    where: { id: existing.id },
    data: {
      ...(action ? { action } : {}),
      ...(input.targetProgress !== undefined ? { targetProgress } : {}),
      ...(status ? { status } : {}),
    },
    select: planningAssignmentSelect,
  });

  const clockIns = await loadClockInsForAssignments(prisma, assignment.date, [assignment]);
  return { assignment: serializePlanningAssignment(assignment, clockIns) };
}

export async function deletePlanningAssignment(prisma: PrismaClient, user: AuthLikeUser, assignmentId: string) {
  const existing = await getScopedPlanningAssignment(prisma, user, assignmentId);
  if (!existing) {
    return planningError('NOT_FOUND', 'Assignation introuvable dans votre périmètre.', 404);
  }

  await prisma.planningAssignment.update({
    where: { id: existing.id },
    data: {
      status: PlanningAssignmentStatus.CANCELLED,
      deletedAt: new Date(),
    },
  });

  return new Response(null, { status: 204 });
}

export async function duplicatePlanningAssignments(
  prisma: PrismaClient,
  user: AuthLikeUser,
  sourceDateValue: string,
  targetDateValue: string,
): Promise<DuplicateAssignmentsResponse | Response> {
  const sourceDate = parsePlanningDate(sourceDateValue);
  const targetDate = parsePlanningDate(targetDateValue);

  if (!sourceDate || !targetDate) {
    return planningError('INVALID_DATE', 'Dates source et cible invalides.', 400);
  }

  if (formatPlanningDate(sourceDate) === formatPlanningDate(targetDate)) {
    return planningError('SAME_DATE', 'Les dates source et cible doivent être différentes.', 400);
  }

  const sourceRangeError = validateDateWindow(sourceDate);
  if (sourceRangeError) return sourceRangeError;
  const targetRangeError = validateDateWindow(targetDate);
  if (targetRangeError) return targetRangeError;

  const sourceSiteWhere = operationalPlanningSiteWhere(user, sourceDate);
  const targetSiteWhere = operationalPlanningSiteWhere(user, targetDate);
  const [sourceAssignments, targetCount, validTargetSites, validSupervisorIds] = await Promise.all([
    prisma.planningAssignment.findMany({
      where: {
        date: sourceDate,
        deletedAt: null,
        site: sourceSiteWhere,
      },
      orderBy: [{ site: { name: 'asc' } }, { supervisor: { firstName: 'asc' } }, { id: 'asc' }],
      select: planningAssignmentSelect,
    }),
    prisma.planningAssignment.count({
      where: {
        date: targetDate,
        deletedAt: null,
        site: targetSiteWhere,
      },
    }),
    prisma.site.findMany({ where: targetSiteWhere, select: { id: true } }),
    getScopedSupervisorIds(prisma, user, targetDate),
  ]);

  if (sourceAssignments.length === 0) {
    return planningError('NO_ASSIGNMENTS', 'Aucune assignation à dupliquer pour la date source.', 404);
  }

  if (targetCount > 0) {
    return planningError('TARGET_HAS_ASSIGNMENTS', 'La date cible contient déjà des assignations.', 409);
  }

  const targetSiteIds = new Set(validTargetSites.map((site) => site.id));
  const targetSupervisorIds = new Set(validSupervisorIds);
  const validAssignments = sourceAssignments.filter(
    (assignment) => targetSiteIds.has(assignment.siteId) && targetSupervisorIds.has(assignment.supervisorId),
  );

  if (validAssignments.length === 0) {
    return planningError('NO_VALID_ASSIGNMENTS', 'Aucune assignation valide à dupliquer.', 400);
  }

  const created = await prisma.$transaction(
    validAssignments.map((assignment) =>
      prisma.planningAssignment.create({
        data: {
          date: targetDate,
          supervisorId: assignment.supervisorId,
          siteId: assignment.siteId,
          action: assignment.action,
          targetProgress: assignment.targetProgress,
          status: PlanningAssignmentStatus.ASSIGNED,
          createdById: user.id,
        },
        select: planningAssignmentSelect,
      }),
    ),
  );

  return {
    createdCount: created.length,
    skippedCount: sourceAssignments.length - created.length,
    assignments: created.map((assignment) => serializePlanningAssignment(assignment, [])),
  };
}

function getScopedPlanningAssignment(prisma: PrismaClient, user: AuthLikeUser, assignmentId: string) {
  return prisma.planningAssignment.findFirst({
    where: {
      id: assignmentId,
      deletedAt: null,
      site: operationalPlanningSiteWhere(user),
    },
    select: planningAssignmentSelect,
  });
}

async function validateAssignmentInput(prisma: PrismaClient, user: AuthLikeUser, input: CreateAssignmentRequest) {
  const date = parsePlanningDate(input.date);
  if (!date) {
    return planningError('INVALID_DATE', 'Date invalide.', 400);
  }

  const rangeError = validateDateWindow(date);
  if (rangeError) return rangeError;

  const supervisorId = normalizeId(input.supervisorId);
  const siteId = normalizeId(input.siteId);
  const action = normalizeOptionalAction(input.action);
  const targetProgress = normalizeTargetProgress(input.targetProgress);

  if (!supervisorId || !siteId || !action) {
    return planningError('INVALID_REQUEST', 'Superviseur, chantier et action sont requis.', 400);
  }

  if (targetProgress instanceof Response) return targetProgress;

  const [site, supervisorIds] = await Promise.all([
    prisma.site.findFirst({
      where: {
        id: siteId,
        ...operationalPlanningSiteWhere(user, date),
      },
      select: { id: true },
    }),
    getScopedSupervisorIds(prisma, user, date),
  ]);

  if (!site) {
    return planningError('SITE_NOT_FOUND', 'Chantier introuvable dans votre périmètre.', 404);
  }

  if (!supervisorIds.includes(supervisorId)) {
    return planningError('SUPERVISOR_NOT_FOUND', 'Superviseur introuvable dans votre périmètre.', 404);
  }

  return {
    date,
    supervisorId,
    siteId,
    action,
    targetProgress,
  };
}

async function getScopedSupervisorIds(prisma: PrismaClient, user: AuthLikeUser, date: Date) {
  const supervisors = await prisma.user.findMany({
    where: {
      role: Role.SUPERVISOR,
      isActive: true,
      teamMemberships: {
        some: {
          status: TeamMemberStatus.ACTIVE,
          team: {
            status: TeamStatus.ACTIVE,
            site: operationalPlanningSiteWhere(user, date),
          },
        },
      },
    },
    select: { id: true },
  });

  return supervisors.map((supervisor) => supervisor.id);
}

async function loadClockInsForAssignments(
  prisma: PrismaClient,
  date: Date,
  assignments: { siteId: string; supervisorId: string }[],
): Promise<ClockInRow[]> {
  if (assignments.length === 0) return [];

  return prisma.clockInRecord.findMany({
    where: {
      clockInDate: date,
      status: ClockInStatus.VALID,
      OR: assignments.map((assignment) => ({
        siteId: assignment.siteId,
        userId: assignment.supervisorId,
      })),
    },
    orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      siteId: true,
      userId: true,
      type: true,
      timestampLocal: true,
      createdAt: true,
    },
  });
}

const planningAssignmentSelect = {
  id: true,
  date: true,
  supervisorId: true,
  siteId: true,
  action: true,
  targetProgress: true,
  status: true,
  createdAt: true,
  supervisor: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
  site: {
    select: {
      id: true,
      name: true,
      address: true,
    },
  },
} satisfies Prisma.PlanningAssignmentSelect;

const availableSiteSelect = {
  id: true,
  name: true,
  address: true,
  status: true,
  project: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.SiteSelect;

function serializePlanningAssignment(assignment: PlanningAssignmentRow, clockIns: ClockInRow[]): PlanningAssignment {
  return {
    id: assignment.id,
    supervisorId: assignment.supervisorId,
    supervisorName: assignment.supervisor.lastName,
    supervisorFirstName: assignment.supervisor.firstName,
    siteId: assignment.siteId,
    siteName: assignment.site.name,
    siteAddress: assignment.site.address,
    action: assignment.action,
    targetProgress: assignment.targetProgress,
    assignedAt: assignment.date.toISOString(),
    status: assignment.status,
    clockInStatus: getClockInStatus(assignment, clockIns),
  };
}

function getClockInStatus(assignment: Pick<PlanningAssignmentRow, 'siteId' | 'supervisorId'>, clockIns: ClockInRow[]): PlanningClockInStatus {
  const latest = [...clockIns]
    .filter((record) => record.siteId === assignment.siteId && record.userId === assignment.supervisorId)
    .sort((a, b) => b.timestampLocal.getTime() - a.timestampLocal.getTime() || b.createdAt.getTime() - a.createdAt.getTime())[0];

  if (!latest) return 'CLOCKED_OUT';

  if (latest.type === ClockInType.ARRIVAL || latest.type === ClockInType.INTERMEDIATE || latest.type === ClockInType.PAUSE_END) {
    return 'CLOCKED_IN';
  }

  if (latest.type === ClockInType.PAUSE_START) {
    return 'ON_PAUSE';
  }

  return 'CLOCKED_OUT';
}

function parsePlanningDate(value: string | null | undefined) {
  const clean = normalizeId(value);
  if (!clean || !/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;

  const date = new Date(`${clean}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function validateDateWindow(date: Date) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const diffDays = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays > 30 || diffDays < -30) {
    return planningError('INVALID_DATE', "La date doit être dans les 30 jours avant ou après aujourd'hui.", 400);
  }

  return null;
}

function normalizeId(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed;
}

function normalizeOptionalAction(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed;
}

function normalizeTargetProgress(value: number | null | undefined): number | null | Response {
  if (value === undefined || value === null) return null;

  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 0 || numberValue > 100) {
    return planningError('INVALID_PROGRESS', 'La progression cible doit être comprise entre 0 et 100.', 400);
  }

  return numberValue;
}

function normalizePlanningStatus(status: PlanningAssignmentStatus | undefined) {
  if (!status) return null;

  return Object.values(PlanningAssignmentStatus).includes(status) ? status : null;
}

function formatPlanningDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function planningError(code: string, message: string, status: number) {
  return Response.json({ code, message }, { status });
}
