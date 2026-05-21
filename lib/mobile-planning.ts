import {
  ClockInStatus,
  ClockInType,
  GeneralSupervisorSiteScopeStatus,
  PlanningAssignmentStatus,
  PlanningWorkLocationType,
  Prisma,
  Role,
  SiteStatus,
  type PrismaClient,
} from '@prisma/client';
import type {
  CreateAssignmentRequest,
  DuplicateAssignmentsResponse,
  PlanningAssignment,
  PlanningClockInStatusItem,
  PlanningClockInStatus,
  PlanningDayResponse,
  UpdateAssignmentRequest,
  SupervisorMyAssignmentsResponse,
} from '@/types/mobile-planning';
import { createInternalPhotoUrl } from '@/lib/photos';
import { BE_FIELD_USER_ROLES, CLASSIC_FIELD_USER_ROLES, FIELD_USER_ROLES } from '@/lib/field-roles';
import { generalSupervisorPlanningSiteWhere } from '@/lib/general-supervisor-scopes';

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
  const allowedRoles: readonly Role[] = [Role.GENERAL_SUPERVISOR, Role.BE_MANAGER, Role.PROJECT_MANAGER];

  return allowedRoles.includes(role);
}

export function canAccessWebPlanning(role: Role) {
  const allowedRoles: readonly Role[] = [
    Role.GENERAL_SUPERVISOR,
    Role.BE_MANAGER,
    Role.PROJECT_MANAGER,
    Role.DIRECTION,
    Role.ADMIN,
  ];

  return allowedRoles.includes(role);
}

export function canMutateWebPlanning(role: Role) {
  const allowedRoles: readonly Role[] = [Role.GENERAL_SUPERVISOR, Role.BE_MANAGER, Role.PROJECT_MANAGER];

  return allowedRoles.includes(role);
}

export function canAccessSupervisorPlanning(role: Role) {
  return FIELD_USER_ROLES.includes(role);
}

export function operationalPlanningSiteWhere(user: AuthLikeUser, _date?: Date): Prisma.SiteWhereInput {
  if (user.role === Role.GENERAL_SUPERVISOR) {
    if (!_date) {
      return {
        status: SiteStatus.ACTIVE,
        generalSupervisorScopes: {
          some: {
            generalSupervisorId: user.id,
            status: GeneralSupervisorSiteScopeStatus.ACTIVE,
          },
        },
      };
    }

    return generalSupervisorPlanningSiteWhere(user, _date);
  }

  return {
    status: SiteStatus.ACTIVE,
    ...(user.role === Role.PROJECT_MANAGER
      ? {
          project: {
            projectManagerId: user.id,
          },
        }
      : {}),
  };
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

  if (sites.length === 0) {
    console.warn('Mobile planning scope empty:', {
      date: formatPlanningDate(parsedDate),
      reason: 'NO_SCOPED_SITES',
      userId: user.id,
    });
  }

  if (scopedSupervisorIds.length === 0) {
    console.warn('Mobile planning supervisor scope empty:', {
      date: formatPlanningDate(parsedDate),
      reason: 'NO_SCOPED_SUPERVISORS',
      userId: user.id,
    });
  }

  const assignedSupervisorIds = await getAssignedSupervisorIdsForDay(prisma, parsedDate, scopedSupervisorIds);

  if (scopedSupervisorIds.length > 0 && scopedSupervisorIds.length === assignedSupervisorIds.size) {
    console.warn('Mobile planning supervisors all assigned:', {
      date: formatPlanningDate(parsedDate),
      reason: 'ALL_SCOPED_SUPERVISORS_ASSIGNED',
      userId: user.id,
    });
  }

  const [supervisors, clockIns, yesterdayCount] = await Promise.all([
    prisma.user.findMany({
      where: {
        id: { in: scopedSupervisorIds },
        role: {
          in: [...FIELD_USER_ROLES],
        },
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
    clockInStatuses: buildClockInStatuses(assignments, clockIns),
    unassignedSupervisors: supervisors.map((supervisor) => ({
      id: supervisor.id,
      firstName: supervisor.firstName,
      name: supervisor.lastName,
      email: supervisor.email,
      contact: supervisor.contact,
      isActive: supervisor.isActive,
      availabilityLabel: getSupervisorAvailabilityLabel(supervisor.id, assignedSupervisorIds),
      assignedSiteName: assignedSupervisorIds.get(supervisor.id) ?? null,
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

  const existingTasks = await prisma.planningAssignment.findMany({
    where: {
      date: normalized.date,
      supervisorId: normalized.supervisorId,
      siteId: normalized.siteId,
      deletedAt: null,
    },
    select: { id: true, action: true, targetProgress: true, workLocationType: true },
  });

  if (existingTasks.some((task) => isSameTask(task, normalized))) {
    return planningError('TASK_DUPLICATE', 'Cette tache existe deja pour cette ressource sur ce chantier.', 409);
  }

  let assignment: PlanningAssignmentRow;
  try {
    assignment = await prisma.planningAssignment.create({
      data: {
        date: normalized.date,
        supervisorId: normalized.supervisorId,
        siteId: normalized.siteId,
        action: normalized.action,
        targetProgress: normalized.targetProgress,
        workLocationType: normalized.workLocationType,
        status: PlanningAssignmentStatus.ASSIGNED,
        createdById: user.id,
      },
      select: planningAssignmentSelect,
    });
  } catch (error) {
    const uniqueTarget = getUniqueConstraintTarget(error);
    if (uniqueTarget) {
      if (isOldSupervisorDateConstraint(uniqueTarget)) {
        return planningError(
          'PLANNING_TASKS_MIGRATION_REQUIRED',
          "La base de donnees bloque encore les assignations multi-taches. Executez `npx prisma migrate deploy` pour appliquer la migration planning_multiple_tasks_per_site.",
          409,
        );
      }

      if (isSupervisorDateSiteConstraint(uniqueTarget)) {
        return planningError(
          'PLANNING_TASKS_MIGRATION_REQUIRED',
          "La base de donnees bloque encore les assignations multi-taches sur un meme chantier. Executez `npx prisma migrate deploy` pour appliquer la migration planning_multiple_tasks_per_site.",
          409,
        );
      }

      return planningError('TASK_DUPLICATE', 'Cette tache existe deja pour cette ressource sur ce chantier.', 409);
    }

    throw error;
  }

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
  const workLocationType = normalizeWorkLocationType(input.workLocationType);

  if (input.action !== undefined && !action) {
    return planningError('INVALID_ACTION', "L'action est requise.", 400);
  }

  if (targetProgress instanceof Response) {
    return targetProgress;
  }

  if (input.status !== undefined && !status) {
    return planningError('INVALID_STATUS', 'Statut de planning invalide.', 400);
  }

  if (input.workLocationType !== undefined && !workLocationType) {
    return planningError('INVALID_WORK_LOCATION', 'Type de travail invalide.', 400);
  }

  const assignment = await prisma.planningAssignment.update({
    where: { id: existing.id },
    data: {
      ...(action ? { action } : {}),
      ...(input.targetProgress !== undefined ? { targetProgress } : {}),
      ...(status ? { status } : {}),
      ...(workLocationType ? { workLocationType } : {}),
    },
    select: planningAssignmentSelect,
  });

  const clockIns = await loadClockInsForAssignments(prisma, assignment.date, [assignment]);
  return { assignment: serializePlanningAssignment(assignment, clockIns) };
}

export async function getSupervisorMyAssignments(
  prisma: PrismaClient,
  user: AuthLikeUser,
  dateValue: string,
): Promise<SupervisorMyAssignmentsResponse | Response> {
  const parsedDate = parsePlanningDate(dateValue);
  if (!parsedDate) {
    return planningError('INVALID_DATE', 'Date invalide.', 400);
  }

  const assignments = await prisma.planningAssignment.findMany({
    where: {
      date: parsedDate,
      supervisorId: user.id,
      deletedAt: null,
    },
    orderBy: [{ site: { name: 'asc' } }, { id: 'asc' }],
    select: {
      id: true,
      date: true,
      siteId: true,
      action: true,
      targetProgress: true,
      status: true,
      workLocationType: true,
      site: {
        select: {
          name: true,
          address: true,
        },
      },
      photos: {
        where: {
          uploadedById: user.id,
          isDeleted: false,
        },
        orderBy: [{ takenAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          filename: true,
          takenAt: true,
        },
      },
    },
  });

  return {
    date: formatPlanningDate(parsedDate),
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      date: formatPlanningDate(assignment.date),
      siteId: assignment.siteId,
      siteName: assignment.site.name,
      siteAddress: assignment.site.address,
      action: assignment.action,
      targetProgress: assignment.targetProgress,
      status: assignment.status,
      workLocationType: assignment.workLocationType,
      photos: assignment.photos.map((photo) => ({
        id: photo.id,
        filename: photo.filename,
        takenAt: photo.takenAt.toISOString(),
        url: createInternalPhotoUrl(photo.id),
      })),
    })),
  };
}

export async function updateSupervisorAssignmentStatus(
  prisma: PrismaClient,
  user: AuthLikeUser,
  assignmentId: string,
  input: UpdateAssignmentRequest,
) {
  const status = normalizePlanningStatus(input.status);
  if (!status || (status !== PlanningAssignmentStatus.IN_PROGRESS && status !== PlanningAssignmentStatus.COMPLETED)) {
    return planningError('INVALID_STATUS', 'Statut de planning invalide.', 400);
  }

  const existing = await prisma.planningAssignment.findFirst({
    where: {
      id: assignmentId,
      supervisorId: user.id,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });

  if (!existing) {
    return planningError('NOT_FOUND', 'Assignation introuvable.', 404);
  }

  const assignment = await prisma.planningAssignment.update({
    where: { id: existing.id },
    data: { status },
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
  const [sourceAssignments, existingTargetAssignments, validTargetSites, validSupervisorIds] = await Promise.all([
    prisma.planningAssignment.findMany({
      where: {
        date: sourceDate,
        deletedAt: null,
        site: sourceSiteWhere,
      },
      orderBy: [{ site: { name: 'asc' } }, { supervisor: { firstName: 'asc' } }, { id: 'asc' }],
      select: planningAssignmentSelect,
    }),
    prisma.planningAssignment.findMany({
      where: {
        date: targetDate,
        deletedAt: null,
        site: targetSiteWhere,
      },
      select: {
        supervisorId: true,
        siteId: true,
        action: true,
        targetProgress: true,
        workLocationType: true,
      },
    }),
    prisma.site.findMany({ where: targetSiteWhere, select: { id: true } }),
    getScopedSupervisorIds(prisma, user, targetDate),
  ]);

  if (sourceAssignments.length === 0) {
    return planningError('NO_ASSIGNMENTS', 'Aucune assignation à dupliquer pour la date source.', 404);
  }

  const targetSiteIds = new Set(validTargetSites.map((site) => site.id));
  const targetSupervisorIds = new Set(validSupervisorIds);
  const existingTargetKeys = new Set(
    existingTargetAssignments.map((assignment) =>
      buildTaskKey(
        assignment.supervisorId,
        assignment.siteId,
        assignment.action,
        assignment.targetProgress,
        assignment.workLocationType,
      ),
    ),
  );
  const validAssignments: PlanningAssignmentRow[] = [];

  for (const assignment of sourceAssignments) {
    const key = buildTaskKey(
      assignment.supervisorId,
      assignment.siteId,
      assignment.action,
      assignment.targetProgress,
      assignment.workLocationType,
    );

    if (!targetSiteIds.has(assignment.siteId) || !targetSupervisorIds.has(assignment.supervisorId) || existingTargetKeys.has(key)) {
      continue;
    }

    existingTargetKeys.add(key);
    validAssignments.push(assignment);
  }

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
          workLocationType: assignment.workLocationType,
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
      ...(user.role === Role.BE_MANAGER
        ? {
            supervisor: {
              role: Role.BE_RESOURCE,
            },
          }
        : {}),
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
  const workLocationType = normalizeWorkLocationType(input.workLocationType) ?? PlanningWorkLocationType.ON_SITE;

  if (!supervisorId || !siteId || !action) {
    return planningError('INVALID_REQUEST', 'Ressource terrain, chantier et action sont requis.', 400);
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
    return planningError('SUPERVISOR_NOT_FOUND', 'Ressource terrain introuvable.', 404);
  }

  return {
    date,
    supervisorId,
    siteId,
    action,
    targetProgress,
    workLocationType,
  };
}

async function getScopedSupervisorIds(prisma: PrismaClient, user: AuthLikeUser, _date: Date) {
  const roles = user.role === Role.BE_MANAGER ? BE_FIELD_USER_ROLES : CLASSIC_FIELD_USER_ROLES;
  const supervisors = await prisma.user.findMany({
    where: {
      role: {
        in: [...roles],
      },
      isActive: true,
    },
    select: { id: true },
  });

  return supervisors.map((supervisor) => supervisor.id);
}

async function getAssignedSupervisorIdsForDay(
  prisma: PrismaClient,
  date: Date,
  supervisorIds: string[],
) {
  if (supervisorIds.length === 0) {
    return new Map<string, string>();
  }

  const assignments = await prisma.planningAssignment.findMany({
    where: {
      date,
      deletedAt: null,
      supervisorId: {
        in: supervisorIds,
      },
    },
    select: {
      supervisorId: true,
      site: {
        select: {
          name: true,
        },
      },
    },
  });

  const sitesBySupervisor = new Map<string, Set<string>>();

  for (const assignment of assignments) {
    const siteNames = sitesBySupervisor.get(assignment.supervisorId) ?? new Set<string>();
    siteNames.add(assignment.site.name);
    sitesBySupervisor.set(assignment.supervisorId, siteNames);
  }

  return new Map(
    [...sitesBySupervisor.entries()].map(([supervisorId, siteNames]) => [
      supervisorId,
      [...siteNames].join(', '),
    ]),
  );
}

function getSupervisorAvailabilityLabel(supervisorId: string, assignedSupervisorIds: Map<string, string>) {
  const siteName = assignedSupervisorIds.get(supervisorId);
  return siteName ? `Assigne sur ${siteName}` : 'Disponible';
}

function buildTaskKey(
  supervisorId: string,
  siteId: string,
  action: string,
  targetProgress: number | null,
  workLocationType: PlanningWorkLocationType,
) {
  return `${supervisorId}:${siteId}:${normalizeTaskActionKey(action)}:${targetProgress ?? 'null'}:${workLocationType}`;
}

function normalizeTaskActionKey(action: string) {
  return action.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr-FR');
}

function isSameTask(
  existing: { action: string; targetProgress: number | null; workLocationType: PlanningWorkLocationType },
  normalized: { action: string; targetProgress: number | null; workLocationType: PlanningWorkLocationType },
) {
  return (
    normalizeTaskActionKey(existing.action) === normalizeTaskActionKey(normalized.action) &&
    existing.targetProgress === normalized.targetProgress &&
    existing.workLocationType === normalized.workLocationType
  );
}

function getUniqueConstraintTarget(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return null;
  }

  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.filter((item): item is string => typeof item === 'string');
  }

  if (typeof target === 'string') {
    return [target];
  }

  return [];
}

function isOldSupervisorDateConstraint(target: string[]) {
  const normalized = target.join(' ').toLowerCase();
  return (
    (normalized.includes('supervisorid') || normalized.includes('supervisor_date')) &&
    normalized.includes('date') &&
    !normalized.includes('siteid') &&
    !normalized.includes('date_site')
  );
}

function isSupervisorDateSiteConstraint(target: string[]) {
  const normalized = target.join(' ').toLowerCase();
  return (
    (normalized.includes('supervisorid') || normalized.includes('supervisor_date')) &&
    normalized.includes('date') &&
    (normalized.includes('siteid') || normalized.includes('date_site'))
  );
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
  workLocationType: true,
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
  createdBy: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
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
    workLocationType: assignment.workLocationType,
    clockInStatus: getClockInStatus(assignment, clockIns),
    createdBy: {
      id: assignment.createdBy.id,
      firstName: assignment.createdBy.firstName,
      lastName: assignment.createdBy.lastName,
      role: assignment.createdBy.role,
    },
  };
}

function buildClockInStatuses(assignments: PlanningAssignmentRow[], clockIns: ClockInRow[]): PlanningClockInStatusItem[] {
  return assignments.map((assignment) => {
    const latest = getLatestClockIn(assignment, clockIns);

    return {
      supervisorId: assignment.supervisorId,
      siteId: assignment.siteId,
      status: getClockInStatus(assignment, clockIns),
      lastEventAt: latest?.timestampLocal.toISOString() ?? null,
    };
  });
}

function getClockInStatus(assignment: Pick<PlanningAssignmentRow, 'siteId' | 'supervisorId'>, clockIns: ClockInRow[]): PlanningClockInStatus {
  const latest = getLatestClockIn(assignment, clockIns);

  if (!latest) return 'CLOCKED_OUT';

  if (latest.type === ClockInType.ARRIVAL || latest.type === ClockInType.INTERMEDIATE || latest.type === ClockInType.PAUSE_END) {
    return 'CLOCKED_IN';
  }

  if (latest.type === ClockInType.PAUSE_START) {
    return 'ON_PAUSE';
  }

  return 'CLOCKED_OUT';
}

function getLatestClockIn(assignment: Pick<PlanningAssignmentRow, 'siteId' | 'supervisorId'>, clockIns: ClockInRow[]) {
  return [...clockIns]
    .filter((record) => record.siteId === assignment.siteId && record.userId === assignment.supervisorId)
    .sort((a, b) => b.timestampLocal.getTime() - a.timestampLocal.getTime() || b.createdAt.getTime() - a.createdAt.getTime())[0];
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

function normalizeWorkLocationType(value: PlanningWorkLocationType | undefined) {
  if (!value) return null;

  return Object.values(PlanningWorkLocationType).includes(value) ? value : null;
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
