import {
  ClockInStatus,
  ClockInType,
  FreeMissionStatus,
  NegotiationAssignmentStatus,
  PlanningAssignmentStatus,
  PlanningWorkLocationType,
  Prisma,
  Role,
  ProjectStatus,
  SiteStatus,
  type PrismaClient,
} from '@prisma/client';
import type {
  CreateTaskProgressUpdateRequest,
  CreateAssignmentRequest,
  DuplicateAssignmentsResponse,
  PlanningAssignment,
  PlanningClockInStatusItem,
  PlanningClockInStatus,
  PlanningDayResponse,
  TaskProgressUpdateItem,
  TaskProgressUpdateResponse,
  UpdateAssignmentRequest,
  SupervisorMyAssignment,
  SupervisorMyAssignmentsResponse,
} from '@/types/mobile-planning';
import { createInternalPhotoUrl } from '@/lib/photos';
import {
  BUSINESS_MANAGER_ROLES,
  CLASSIC_FIELD_USER_ROLES,
  FIELD_USER_ROLES,
  getBusinessManagedResourceRoles,
  isBusinessManagerRole,
} from '@/lib/field-roles';
import { generalSupervisorPlanningSiteWhere } from '@/lib/general-supervisor-scopes';
import { freeMissionSelect, listFreeMissions, listMyFreeMissions, serializeFreeMission } from '@/lib/free-missions';

type AuthLikeUser = {
  id: string;
  role: Role;
};

type PlanningAssignmentRow = Prisma.PlanningAssignmentGetPayload<{
  select: typeof planningAssignmentSelect;
}>;

type SupervisorAssignmentRow = Prisma.PlanningAssignmentGetPayload<{
  select: typeof supervisorAssignmentSelect;
}>;

type ClockInRow = {
  siteId: string;
  userId: string;
  type: ClockInType;
  timestampLocal: Date;
  createdAt: Date;
};

export function canAccessMobilePlanning(role: Role) {
  const allowedRoles: readonly Role[] = [Role.GENERAL_SUPERVISOR, ...BUSINESS_MANAGER_ROLES, Role.PROJECT_MANAGER];

  return allowedRoles.includes(role);
}

export function canAccessWebPlanning(role: Role) {
  const allowedRoles: readonly Role[] = [
    Role.GENERAL_SUPERVISOR,
    ...BUSINESS_MANAGER_ROLES,
    Role.PROJECT_MANAGER,
    Role.DIRECTION,
    Role.ADMIN,
  ];

  return allowedRoles.includes(role);
}

export function canMutateWebPlanning(role: Role) {
  const allowedRoles: readonly Role[] = [Role.GENERAL_SUPERVISOR, ...BUSINESS_MANAGER_ROLES, Role.PROJECT_MANAGER];

  return allowedRoles.includes(role);
}

export function canManageFleetProgress(role: Role) {
  return role === Role.FLEET_MANAGER;
}

export function canAccessSupervisorPlanning(role: Role) {
  return FIELD_USER_ROLES.includes(role);
}

export function operationalPlanningSiteWhere(user: AuthLikeUser, _date?: Date): Prisma.SiteWhereInput {
  if (user.role === Role.GENERAL_SUPERVISOR) {
    return generalSupervisorPlanningSiteWhere(user, _date ?? new Date());
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

function operationalPlanningProjectWhere(user: AuthLikeUser, date?: Date): Prisma.ProjectWhereInput {
  const activeProjectWhere = {
    status: { notIn: [ProjectStatus.ARCHIVED, ProjectStatus.COMPLETED] },
  } satisfies Prisma.ProjectWhereInput;

  if (user.role === Role.PROJECT_MANAGER) {
    return {
      ...activeProjectWhere,
      projectManagerId: user.id,
    };
  }

  if (user.role === Role.GENERAL_SUPERVISOR) {
    const siteWhere = operationalPlanningSiteWhere(user, date);
    return {
      ...activeProjectWhere,
      sites: {
        some: siteWhere,
      },
    };
  }

  return activeProjectWhere;
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
  const assignmentScopeWhere = planningAssignmentScopeWhere(user);
  const [assignments, freeMissionResponse, negotiationAssignments, sites, projects, negotiationZones, scopedSupervisorIds] = await Promise.all([
    prisma.planningAssignment.findMany({
      where: {
        date: parsedDate,
        deletedAt: null,
        site: siteWhere,
        ...assignmentScopeWhere,
      },
      orderBy: [
        { site: { name: 'asc' } },
        { supervisor: { firstName: 'asc' } },
        { supervisor: { lastName: 'asc' } },
        { id: 'asc' },
      ],
      select: planningAssignmentSelect,
    }),
    listFreeMissions(prisma, user, formatPlanningDate(parsedDate)),
    user.role === Role.NEGOTIATION_MANAGER
      ? prisma.negotiationAssignment.findMany({
          where: {
            date: parsedDate,
            deletedAt: null,
            project: operationalPlanningProjectWhere(user, parsedDate),
          },
          orderBy: [
            { project: { name: 'asc' } },
            { zone: { name: 'asc' } },
            { assignee: { firstName: 'asc' } },
            { assignee: { lastName: 'asc' } },
            { id: 'asc' },
          ],
          include: {
            project: { select: { id: true, name: true } },
            zone: true,
            assignee: { select: { id: true, firstName: true, lastName: true } },
            createdBy: { select: { id: true, firstName: true, lastName: true, role: true } },
            sessions: {
              where: { date: parsedDate },
              select: { status: true },
            },
          },
        })
      : Promise.resolve([]),
    prisma.site.findMany({
      where: siteWhere,
      orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
      select: availableSiteSelect,
    }),
    prisma.project.findMany({
      where: operationalPlanningProjectWhere(user, parsedDate),
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
      },
    }),
    user.role === Role.NEGOTIATION_MANAGER
      ? prisma.negotiationZone.findMany({
          where: {
            project: operationalPlanningProjectWhere(user, parsedDate),
          },
          orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }],
          include: {
            project: { select: { id: true, name: true } },
            _count: { select: { scopes: true } },
          },
        })
      : Promise.resolve([]),
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

  const [supervisors, clockIns, yesterdayCount, yesterdayFreeMissionResponse] = await Promise.all([
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
        ...assignmentScopeWhere,
      },
    }),
    listFreeMissions(prisma, user, formatPlanningDate(addDays(parsedDate, -1))),
  ]);
  const yesterdayTaskCount = yesterdayCount + yesterdayFreeMissionResponse.missions.length;

  return {
    date: formatPlanningDate(parsedDate),
    assignments: [
      ...assignments.map((assignment) => serializePlanningAssignment(assignment, clockIns)),
      ...freeMissionResponse.missions.map(serializeFreeMissionAsPlanningAssignment),
      ...negotiationAssignments.map(serializeNegotiationAssignmentAsPlanningAssignment),
    ],
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
    availableProjects: projects.map((project) => ({
      id: project.id,
      name: project.name,
    })),
    availableSites: sites.map((site) => ({
      id: site.id,
      name: site.name,
      address: site.address,
      siteType: site.siteType,
      requiresClockIn: site.requiresClockIn,
      status: site.status,
      project: {
        id: site.project.id,
        name: site.project.name,
      },
    })),
    availableNegotiationZones: negotiationZones.map((zone) => ({
      id: zone.id,
      projectId: zone.projectId,
      name: zone.name,
      city: zone.city,
      region: zone.region,
      scopeCount: zone._count.scopes,
      project: zone.project,
    })),
    hasAssignments: assignments.length + freeMissionResponse.missions.length + negotiationAssignments.length > 0,
    canDuplicateFromYesterday: assignments.length + freeMissionResponse.missions.length + negotiationAssignments.length === 0 && yesterdayTaskCount > 0,
  };
}

export async function createPlanningAssignment(
  prisma: PrismaClient,
  user: AuthLikeUser,
  input: CreateAssignmentRequest,
) {
  const supervisorIds = normalizeSupervisorIds(input);
  if (supervisorIds instanceof Response) return supervisorIds;

  if (supervisorIds.length > 1) {
    const assignments: PlanningAssignment[] = [];
    let skippedCount = 0;

    for (const supervisorId of supervisorIds) {
      const result = await createSinglePlanningAssignment(
        prisma,
        user,
        { ...withoutSupervisorIds(input), supervisorId },
        { skipDuplicates: true },
      );

      if (result instanceof Response) return result;
      if ('skipped' in result) {
        skippedCount += 1;
        continue;
      }
      if (result.assignment) assignments.push(result.assignment);
    }

    return {
      assignment: assignments[0],
      assignments,
      createdCount: assignments.length,
      skippedCount,
    };
  }

  const supervisorId = supervisorIds[0];
  if (!supervisorId) {
    return planningError('INVALID_REQUEST', 'Au moins une ressource terrain est requise.', 400);
  }

  return createSinglePlanningAssignment(prisma, user, { ...withoutSupervisorIds(input), supervisorId });
}

async function createSinglePlanningAssignment(
  prisma: PrismaClient,
  user: AuthLikeUser,
  input: CreateAssignmentRequest,
  options: { skipDuplicates?: boolean } = {},
) {
  if (input.workLocationType === PlanningWorkLocationType.FREE_MISSION) {
    if (user.role === Role.NEGOTIATION_MANAGER) {
      return createSingleNegotiationPlanningAssignment(prisma, user, input, options);
    }

    return createSingleFreeMissionPlanningAssignment(prisma, user, input, options);
  }

  const normalized = await validateAssignmentInput(prisma, user, input);
  if (normalized instanceof Response) return normalized;

  const existingTasks = await prisma.planningAssignment.findMany({
    where: {
      date: normalized.date,
      supervisorId: normalized.supervisorId,
      siteId: normalized.siteId,
      deletedAt: null,
    },
    select: { id: true, action: true, targetProgress: true, targetQuantity: true, targetUnit: true, plannedDurationMinutes: true, workLocationType: true },
  });

  if (existingTasks.some((task) => isSameTask(task, normalized))) {
    if (options.skipDuplicates) {
      return { skipped: true as const };
    }
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
        targetQuantity: normalized.targetQuantity,
        targetUnit: normalized.targetUnit,
        objectiveText: normalized.objectiveText,
        plannedDurationMinutes: normalized.plannedDurationMinutes,
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

      if (options.skipDuplicates) {
        return { skipped: true as const };
      }

      return planningError('TASK_DUPLICATE', 'Cette tache existe deja pour cette ressource sur ce chantier.', 409);
    }

    throw error;
  }

  return { assignment: serializePlanningAssignment(assignment, []) };
}

async function createSingleFreeMissionPlanningAssignment(
  prisma: PrismaClient,
  user: AuthLikeUser,
  input: CreateAssignmentRequest,
  options: { skipDuplicates?: boolean } = {},
) {
  const normalized = await validateFreeMissionAssignmentInput(prisma, user, input);
  if (normalized instanceof Response) return normalized;

  const existing = await prisma.freeMission.findFirst({
    where: {
      projectId: normalized.projectId,
      assigneeId: normalized.supervisorId,
      date: normalized.date,
      action: normalized.action,
      plannedZone: normalized.plannedZone,
      deletedAt: null,
      status: { not: FreeMissionStatus.CANCELLED },
    },
    select: { id: true },
  });

  if (existing) {
    if (options.skipDuplicates) {
      return { skipped: true as const };
    }
    return planningError('TASK_DUPLICATE', 'Cette zone existe deja pour cette ressource.', 409);
  }

  const mission = await prisma.freeMission.create({
    data: {
      projectId: normalized.projectId,
      assigneeId: normalized.supervisorId,
      date: normalized.date,
      action: normalized.action,
      plannedZone: normalized.plannedZone,
      targetProgress: normalized.targetProgress,
      targetQuantity: normalized.targetQuantity,
      targetUnit: normalized.targetUnit,
      objectiveText: normalized.objectiveText,
      plannedDurationMinutes: normalized.plannedDurationMinutes,
      createdById: user.id,
    },
    select: freeMissionSelect,
  });

  return { assignment: serializeFreeMissionAsPlanningAssignment(serializeFreeMission(mission)) };
}

async function createSingleNegotiationPlanningAssignment(
  prisma: PrismaClient,
  user: AuthLikeUser,
  input: CreateAssignmentRequest,
  options: { skipDuplicates?: boolean } = {},
) {
  const normalized = await validateNegotiationAssignmentInput(prisma, user, input);
  if (normalized instanceof Response) return normalized;

  const existing = await prisma.negotiationAssignment.findFirst({
    where: {
      projectId: normalized.projectId,
      zoneId: normalized.zoneId,
      assigneeId: normalized.supervisorId,
      date: normalized.date,
      deletedAt: null,
      status: { not: NegotiationAssignmentStatus.CANCELLED },
    },
    select: { id: true },
  });

  if (existing) {
    if (options.skipDuplicates) {
      return { skipped: true as const };
    }
    return planningError('TASK_DUPLICATE', 'Cette zone nego existe deja pour cette ressource.', 409);
  }

  const assignment = await prisma.negotiationAssignment.create({
    data: {
      projectId: normalized.projectId,
      zoneId: normalized.zoneId,
      assigneeId: normalized.supervisorId,
      date: normalized.date,
      plannedZone: normalized.zoneName,
      instruction: normalized.action,
      status: NegotiationAssignmentStatus.PLANNED,
      createdById: user.id,
    },
    include: {
      project: { select: { id: true, name: true } },
      zone: true,
      assignee: { select: { id: true, firstName: true, lastName: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true, role: true } },
      sessions: { where: { date: normalized.date }, select: { status: true } },
    },
  });

  return { assignment: serializeNegotiationAssignmentAsPlanningAssignment(assignment) };
}

export async function updatePlanningAssignment(
  prisma: PrismaClient,
  user: AuthLikeUser,
  assignmentId: string,
  input: UpdateAssignmentRequest,
) {
  const existing = await getScopedPlanningAssignment(prisma, user, assignmentId);
  if (!existing) {
    return planningError('NOT_FOUND', 'Assignation introuvable dans votre perimetre.', 404);
  }

  const action = normalizeOptionalAction(input.action);
  const targetProgress = normalizeTargetProgress(input.targetProgress);
  const targetQuantity = normalizeQuantity(input.targetQuantity);
  const targetUnit = normalizeUnit(input.targetUnit);
  const objectiveText = normalizeOptionalText(input.objectiveText);
  const plannedDurationMinutes = normalizePlannedDurationMinutes(input.plannedDurationMinutes);
  const status = normalizePlanningStatus(input.status);
  const workLocationType = normalizeWorkLocationType(input.workLocationType);

  if (input.action !== undefined && !action) {
    return planningError('INVALID_ACTION', "L'action est requise.", 400);
  }

  if (targetProgress instanceof Response) {
    return targetProgress;
  }

  if (targetQuantity instanceof Response) {
    return targetQuantity;
  }

  if (plannedDurationMinutes instanceof Response) {
    return plannedDurationMinutes;
  }

  if (input.status !== undefined && !status) {
    return planningError('INVALID_STATUS', 'Statut de planning invalide.', 400);
  }

  if (input.workLocationType !== undefined && !workLocationType) {
    return planningError('INVALID_WORK_LOCATION', 'Type de travail invalide.', 400);
  }

  const effectiveTargetQuantity = input.targetQuantity !== undefined ? targetQuantity : decimalToNumber(existing.targetQuantity);
  const hasQuantityObjective = effectiveTargetQuantity !== null && effectiveTargetQuantity > 0;
  const normalizedTargetProgress =
    hasQuantityObjective ? null : targetProgress;

  const assignment = await prisma.planningAssignment.update({
    where: { id: existing.id },
    data: {
      ...(action ? { action } : {}),
      ...(input.targetProgress !== undefined || (input.targetQuantity !== undefined && hasQuantityObjective)
        ? { targetProgress: normalizedTargetProgress }
        : {}),
      ...(input.targetQuantity !== undefined ? { targetQuantity } : {}),
      ...(input.targetUnit !== undefined ? { targetUnit } : {}),
      ...(input.objectiveText !== undefined ? { objectiveText } : {}),
      ...(input.plannedDurationMinutes !== undefined ? { plannedDurationMinutes } : {}),
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

  const [assignments, freeMissions, negotiationAssignments] = await Promise.all([
    prisma.planningAssignment.findMany({
    where: {
      date: parsedDate,
      supervisorId: user.id,
      deletedAt: null,
    },
    orderBy: [{ site: { name: 'asc' } }, { id: 'asc' }],
    select: supervisorAssignmentSelect,
    }),
    listMyFreeMissions(prisma, user, formatPlanningDate(parsedDate)),
    prisma.negotiationAssignment.findMany({
      where: {
        date: parsedDate,
        assigneeId: user.id,
        deletedAt: null,
        status: { not: NegotiationAssignmentStatus.CANCELLED },
      },
      orderBy: [{ project: { name: 'asc' } }, { zone: { name: 'asc' } }, { id: 'asc' }],
      include: {
        project: { select: { id: true, name: true } },
        zone: true,
        assignee: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, role: true } },
        sessions: { where: { date: parsedDate }, select: { status: true } },
      },
    }),
  ]);

  return {
    date: formatPlanningDate(parsedDate),
    assignments: [
      ...assignments.map(serializeSupervisorAssignment),
      ...freeMissions.map(serializeFreeMissionAsSupervisorAssignment),
      ...negotiationAssignments.map(serializeNegotiationAssignmentAsSupervisorAssignment),
    ],
  };
}

export async function getTaskProgressUpdates(prisma: PrismaClient, user: AuthLikeUser, assignmentId: string) {
  const assignment = await getAccessibleProgressAssignment(prisma, user, assignmentId);
  if (assignment) {
    return {
      assignment: serializeSupervisorAssignment(assignment),
      updates: assignment.progressUpdates.map(serializeTaskProgressUpdate),
    };
  }

  const mission = await getAccessibleProgressFreeMission(prisma, user, assignmentId);
  if (!mission) {
    return planningError('NOT_FOUND', 'Assignation introuvable.', 404);
  }

  return {
    assignment: serializeFreeMissionAsSupervisorAssignment(serializeFreeMission(mission)),
    updates: mission.progressUpdates.map(serializeTaskProgressUpdate),
  };
}

export async function createTaskProgressUpdate(
  prisma: PrismaClient,
  user: AuthLikeUser,
  assignmentId: string,
  input: CreateTaskProgressUpdateRequest,
): Promise<TaskProgressUpdateResponse | Response> {
  const assignment = await getAccessibleProgressAssignment(prisma, user, assignmentId);
  const mission = assignment ? null : await getAccessibleProgressFreeMission(prisma, user, assignmentId);
  if (!assignment && !mission) {
    return planningError('NOT_FOUND', 'Assignation introuvable.', 404);
  }

  const actualQuantity = normalizeQuantity(input.actualQuantity);
  if (actualQuantity instanceof Response) return actualQuantity;

  const progressInput = normalizeActualProgress(input.progress);
  if (progressInput instanceof Response) return progressInput;

  const targetQuantity = decimalToNumber(assignment ? assignment.targetQuantity : mission?.targetQuantity);
  const hasQuantityTarget = targetQuantity !== null && targetQuantity > 0;
  const progress = calculateActualProgress(
    assignment ? assignment.targetQuantity : mission?.targetQuantity ?? null,
    actualQuantity,
    hasQuantityTarget ? null : progressInput,
  );

  const comment = normalizeOptionalText(input.comment);
  const blocked = Boolean(input.blocked);
  const requestedCompleted = Boolean(input.completed);
  const completed = hasQuantityTarget ? !blocked && actualQuantity !== null && actualQuantity >= targetQuantity : requestedCompleted;

  if (blocked && !comment) {
    return planningError('BLOCKAGE_COMMENT_REQUIRED', 'Un commentaire est requis pour signaler un blocage.', 400);
  }

  if (!hasQuantityTarget && blocked && requestedCompleted) {
    return planningError('BLOCKED_TASK_CANNOT_BE_COMPLETED', 'Une tache bloquee ne peut pas etre marquee terminee.', 400);
  }

  const update = await prisma.taskProgressUpdate.create({
    data: {
      ...(assignment ? { assignmentId } : { freeMissionId: assignmentId }),
      progress,
      actualQuantity,
      comment,
      blocked,
      completed,
      createdById: user.id,
    },
    select: taskProgressUpdateSelect,
  });

  if (assignment) {
    if (completed && assignment.status !== PlanningAssignmentStatus.COMPLETED) {
      await prisma.planningAssignment.update({
        where: { id: assignmentId },
        data: { status: PlanningAssignmentStatus.COMPLETED },
      });
    } else if (!completed && assignment.status === PlanningAssignmentStatus.COMPLETED) {
      await prisma.planningAssignment.update({
        where: { id: assignmentId },
        data: { status: PlanningAssignmentStatus.IN_PROGRESS },
      });
    } else if (!completed && assignment.status === PlanningAssignmentStatus.ASSIGNED && (progress !== null || actualQuantity !== null || blocked || comment)) {
      await prisma.planningAssignment.update({
        where: { id: assignmentId },
        data: { status: PlanningAssignmentStatus.IN_PROGRESS },
      });
    }

    const refreshed = await getAccessibleProgressAssignment(prisma, user, assignmentId);

    return {
      update: serializeTaskProgressUpdate(update),
      assignment: refreshed ? serializeSupervisorAssignment(refreshed) : serializeSupervisorAssignment(assignment),
    };
  }

  const nextMissionStatus = completed
    ? FreeMissionStatus.COMPLETED
    : progress !== null || actualQuantity !== null || blocked || comment
      ? FreeMissionStatus.IN_PROGRESS
      : mission?.status ?? FreeMissionStatus.ASSIGNED;

  if (mission && nextMissionStatus !== mission.status) {
    await prisma.freeMission.update({
      where: { id: assignmentId },
      data: { status: nextMissionStatus },
    });
  }

  const refreshedMission = await getAccessibleProgressFreeMission(prisma, user, assignmentId);

  return {
    update: serializeTaskProgressUpdate(update),
    assignment: refreshedMission
      ? serializeFreeMissionAsSupervisorAssignment(serializeFreeMission(refreshedMission))
      : serializeFreeMissionAsSupervisorAssignment(serializeFreeMission(mission!)),
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
  if (existing) {
    await prisma.planningAssignment.update({
      where: { id: existing.id },
      data: {
        status: PlanningAssignmentStatus.CANCELLED,
        deletedAt: new Date(),
      },
    });

    return new Response(null, { status: 204 });
  }

  const freeMission = await getScopedFreeMissionPlanningAssignment(prisma, user, assignmentId);
  if (freeMission) {
    await prisma.freeMission.update({
      where: { id: freeMission.id },
      data: {
        status: FreeMissionStatus.CANCELLED,
        deletedAt: new Date(),
      },
    });

    return new Response(null, { status: 204 });
  }

  const negotiationAssignment = await getScopedNegotiationPlanningAssignment(prisma, user, assignmentId);
  if (negotiationAssignment) {
    await prisma.negotiationAssignment.update({
      where: { id: negotiationAssignment.id },
      data: {
        status: NegotiationAssignmentStatus.CANCELLED,
        deletedAt: new Date(),
      },
    });

    return new Response(null, { status: 204 });
  }

  return planningError('NOT_FOUND', 'Assignation introuvable dans votre perimetre.', 404);
}

export async function duplicatePlanningAssignments(
  prisma: PrismaClient,
  user: AuthLikeUser,
  sourceDateValue: string,
  targetDateValue: string,
  sourceAssignmentId?: string,
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
  const targetProjectWhere = operationalPlanningProjectWhere(user, targetDate);
  const assignmentScopeWhere = planningAssignmentScopeWhere(user);
  const [
    sourceAssignments,
    sourceFreeMissionResponse,
    existingTargetAssignments,
    existingTargetFreeMissionResponse,
    validTargetSites,
    validTargetProjects,
    validSupervisorIds,
  ] = await Promise.all([
    prisma.planningAssignment.findMany({
      where: {
        date: sourceDate,
        deletedAt: null,
        ...(sourceAssignmentId ? { id: sourceAssignmentId } : {}),
        site: sourceSiteWhere,
        ...assignmentScopeWhere,
      },
      orderBy: [{ site: { name: 'asc' } }, { supervisor: { firstName: 'asc' } }, { id: 'asc' }],
      select: planningAssignmentSelect,
    }),
    listFreeMissions(prisma, user, formatPlanningDate(sourceDate)),
    prisma.planningAssignment.findMany({
      where: {
        date: targetDate,
        deletedAt: null,
        site: targetSiteWhere,
        ...assignmentScopeWhere,
      },
      select: {
        supervisorId: true,
        siteId: true,
        action: true,
        targetProgress: true,
        targetQuantity: true,
        targetUnit: true,
        workLocationType: true,
      },
    }),
    listFreeMissions(prisma, user, formatPlanningDate(targetDate)),
    prisma.site.findMany({ where: targetSiteWhere, select: { id: true } }),
    prisma.project.findMany({ where: targetProjectWhere, select: { id: true } }),
    getScopedSupervisorIds(prisma, user, targetDate),
  ]);

  const sourceFreeMissions = sourceAssignmentId
    ? sourceFreeMissionResponse.missions.filter((mission) => mission.id === sourceAssignmentId)
    : sourceFreeMissionResponse.missions;
  if (sourceAssignments.length === 0 && sourceFreeMissions.length === 0) {
    return planningError('NO_ASSIGNMENTS', 'Aucune assignation à dupliquer pour la date source.', 404);
  }

  const targetSiteIds = new Set(validTargetSites.map((site) => site.id));
  const targetProjectIds = new Set(validTargetProjects.map((project) => project.id));
  const targetSupervisorIds = new Set(validSupervisorIds);
  const existingTargetKeys = new Set(
    existingTargetAssignments.map((assignment) =>
      buildTaskKey(
        assignment.supervisorId,
        assignment.siteId,
        assignment.action,
        assignment.targetProgress,
        assignment.targetQuantity,
        assignment.targetUnit,
        assignment.workLocationType,
      ),
    ),
  );
  const existingTargetFreeMissionKeys = new Set(
    existingTargetFreeMissionResponse.missions.map((mission) =>
      buildFreeMissionKey(mission.assigneeId, mission.projectId, mission.action, mission.plannedZone),
    ),
  );
  const validAssignments: PlanningAssignmentRow[] = [];
  const validFreeMissions: typeof sourceFreeMissions = [];

  for (const assignment of sourceAssignments) {
    const key = buildTaskKey(
      assignment.supervisorId,
      assignment.siteId,
      assignment.action,
      assignment.targetProgress,
      assignment.targetQuantity,
      assignment.targetUnit,
      assignment.workLocationType,
    );

    if (!targetSiteIds.has(assignment.siteId) || !targetSupervisorIds.has(assignment.supervisorId) || existingTargetKeys.has(key)) {
      continue;
    }

    existingTargetKeys.add(key);
    validAssignments.push(assignment);
  }

  for (const mission of sourceFreeMissions) {
    const key = buildFreeMissionKey(mission.assigneeId, mission.projectId, mission.action, mission.plannedZone);

    if (!targetProjectIds.has(mission.projectId) || !targetSupervisorIds.has(mission.assigneeId) || existingTargetFreeMissionKeys.has(key)) {
      continue;
    }

    existingTargetFreeMissionKeys.add(key);
    validFreeMissions.push(mission);
  }

  if (validAssignments.length === 0 && validFreeMissions.length === 0) {
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
          targetProgress: normalizeProgressForQuantity(assignment.targetProgress, assignment.targetQuantity),
          targetQuantity: assignment.targetQuantity,
          targetUnit: assignment.targetUnit,
          objectiveText: assignment.objectiveText,
          workLocationType: assignment.workLocationType,
          status: PlanningAssignmentStatus.ASSIGNED,
          createdById: user.id,
        },
        select: planningAssignmentSelect,
      }),
    ),
  );
  if (validFreeMissions.length > 0) {
    await prisma.freeMission.createMany({
      data: validFreeMissions.map((mission) => ({
        projectId: mission.projectId,
        assigneeId: mission.assigneeId,
        date: targetDate,
        action: mission.action,
        plannedZone: mission.plannedZone,
        targetProgress: mission.targetProgress,
        targetQuantity: mission.targetQuantity,
        targetUnit: mission.targetUnit,
        objectiveText: mission.objectiveText,
        plannedDurationMinutes: mission.plannedDurationMinutes,
        status: FreeMissionStatus.ASSIGNED,
        createdById: user.id,
      })),
    });
  }

  const createdFreeMissionKeys = new Set(
    validFreeMissions.map((mission) => buildFreeMissionKey(mission.assigneeId, mission.projectId, mission.action, mission.plannedZone)),
  );
  const targetFreeMissionResponse =
    validFreeMissions.length > 0 ? await listFreeMissions(prisma, user, formatPlanningDate(targetDate)) : { missions: [] };
  const createdFreeMissionAssignments = targetFreeMissionResponse.missions
    .filter((mission) => createdFreeMissionKeys.has(buildFreeMissionKey(mission.assigneeId, mission.projectId, mission.action, mission.plannedZone)))
    .map(serializeFreeMissionAsPlanningAssignment);

  return {
    createdCount: created.length + createdFreeMissionAssignments.length,
    skippedCount: sourceAssignments.length + sourceFreeMissions.length - created.length - createdFreeMissionAssignments.length,
    assignments: [
      ...created.map((assignment) => serializePlanningAssignment(assignment, [])),
      ...createdFreeMissionAssignments,
    ],
  };
}

function getScopedPlanningAssignment(prisma: PrismaClient, user: AuthLikeUser, assignmentId: string) {
  return prisma.planningAssignment.findFirst({
    where: {
      id: assignmentId,
      deletedAt: null,
      site: operationalPlanningSiteWhere(user),
      ...(isBusinessManagerRole(user.role)
        ? {
            supervisor: {
              role: { in: [...getBusinessManagedResourceRoles(user.role)] },
            },
          }
        : {}),
    },
    select: planningAssignmentSelect,
  });
}

function getScopedFreeMissionPlanningAssignment(prisma: PrismaClient, user: AuthLikeUser, assignmentId: string) {
  return prisma.freeMission.findFirst({
    where: {
      id: assignmentId,
      deletedAt: null,
      status: { not: FreeMissionStatus.CANCELLED },
      project: operationalPlanningProjectWhere(user),
      ...(isBusinessManagerRole(user.role)
        ? {
            assignee: {
              role: { in: [...getBusinessManagedResourceRoles(user.role)] },
            },
          }
        : {}),
    },
    select: { id: true },
  });
}

function getScopedNegotiationPlanningAssignment(prisma: PrismaClient, user: AuthLikeUser, assignmentId: string) {
  return prisma.negotiationAssignment.findFirst({
    where: {
      id: assignmentId,
      deletedAt: null,
      status: { not: NegotiationAssignmentStatus.CANCELLED },
      project: operationalPlanningProjectWhere(user),
      ...(isBusinessManagerRole(user.role)
        ? {
            assignee: {
              role: { in: [...getBusinessManagedResourceRoles(user.role)] },
            },
          }
        : {}),
    },
    select: { id: true },
  });
}

function planningAssignmentScopeWhere(user: AuthLikeUser): Prisma.PlanningAssignmentWhereInput {
  if (!isBusinessManagerRole(user.role)) {
    return {};
  }

  return {
    supervisor: {
      role: { in: [...getBusinessManagedResourceRoles(user.role)] },
    },
  };
}

function getAccessibleProgressAssignment(prisma: PrismaClient, user: AuthLikeUser, assignmentId: string) {
  return prisma.planningAssignment.findFirst({
    where: {
      id: assignmentId,
      deletedAt: null,
      ...(canManageFleetProgress(user.role)
        ? {
            site: operationalPlanningSiteWhere(user),
            supervisor: {
              role: { in: [...getBusinessManagedResourceRoles(user.role)] },
            },
          }
        : { supervisorId: user.id }),
    },
    select: supervisorAssignmentSelect,
  });
}

function getAccessibleProgressFreeMission(prisma: PrismaClient, user: AuthLikeUser, assignmentId: string) {
  return prisma.freeMission.findFirst({
    where: {
      id: assignmentId,
      deletedAt: null,
      status: { not: FreeMissionStatus.CANCELLED },
      ...(canManageFleetProgress(user.role)
        ? {
            assignee: {
              role: { in: [...getBusinessManagedResourceRoles(user.role)] },
            },
          }
        : { assigneeId: user.id }),
    },
    select: freeMissionSelect,
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
  const inputSiteId = normalizeId(input.siteId);
  const projectId = normalizeId(input.projectId);
  const action = normalizeOptionalAction(input.action);
  const targetProgress = normalizeTargetProgress(input.targetProgress);
  const targetQuantity = normalizeQuantity(input.targetQuantity);
  const targetUnit = normalizeUnit(input.targetUnit);
  const objectiveText = normalizeOptionalText(input.objectiveText);
  const plannedDurationMinutes = normalizePlannedDurationMinutes(input.plannedDurationMinutes);
  const workLocationType = normalizeWorkLocationType(input.workLocationType) ?? PlanningWorkLocationType.ON_SITE;

  const requiresProjectOnly = workLocationType === PlanningWorkLocationType.OFFICE;

  if (!supervisorId || !action || (requiresProjectOnly ? !projectId : !inputSiteId)) {
    return planningError(
      'INVALID_REQUEST',
      requiresProjectOnly
        ? 'Ressource terrain, projet et action sont requis pour une tache bureau.'
        : 'Ressource terrain, chantier et action sont requis.',
      400,
    );
  }

  if (targetProgress instanceof Response) return targetProgress;
  if (targetQuantity instanceof Response) return targetQuantity;
  if (plannedDurationMinutes instanceof Response) return plannedDurationMinutes;

  const [site, supervisorIds] = await Promise.all([
    prisma.site.findFirst({
      where: {
        ...(requiresProjectOnly ? { projectId: projectId! } : { id: inputSiteId! }),
        ...operationalPlanningSiteWhere(user, date),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
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

  const normalizedTargetProgress = targetQuantity !== null && targetQuantity > 0 ? null : targetProgress;

  return {
    date,
    supervisorId,
    siteId: site.id,
    action,
    targetProgress: normalizedTargetProgress,
    targetQuantity,
    targetUnit,
    objectiveText,
    plannedDurationMinutes,
    workLocationType,
  };
}

async function validateFreeMissionAssignmentInput(prisma: PrismaClient, user: AuthLikeUser, input: CreateAssignmentRequest) {
  const date = parsePlanningDate(input.date);
  if (!date) {
    return planningError('INVALID_DATE', 'Date invalide.', 400);
  }

  const rangeError = validateDateWindow(date);
  if (rangeError) return rangeError;

  const supervisorId = normalizeId(input.supervisorId);
  const projectId = normalizeId(input.projectId);
  const action = normalizeOptionalAction(input.action);
  const plannedZone = normalizeOptionalText(input.plannedZone);
  const targetProgress = normalizeTargetProgress(input.targetProgress);
  const targetQuantity = normalizeQuantity(input.targetQuantity);
  const targetUnit = normalizeUnit(input.targetUnit);
  const objectiveText = normalizeOptionalText(input.objectiveText);
  const plannedDurationMinutes = normalizePlannedDurationMinutes(input.plannedDurationMinutes);

  if (!supervisorId || !projectId || !action) {
    return planningError('INVALID_REQUEST', 'Ressource terrain, projet et action sont requis pour une zone.', 400);
  }

  if (targetProgress instanceof Response) return targetProgress;
  if (targetQuantity instanceof Response) return targetQuantity;
  if (plannedDurationMinutes instanceof Response) return plannedDurationMinutes;

  const [project, supervisorIds] = await Promise.all([
    prisma.project.findFirst({
      where: {
        id: projectId,
        ...operationalPlanningProjectWhere(user, date),
      },
      select: { id: true },
    }),
    getScopedSupervisorIds(prisma, user, date),
  ]);

  if (!project) {
    return planningError('PROJECT_NOT_FOUND', 'Projet actif introuvable ou non accessible.', 404);
  }

  if (!supervisorIds.includes(supervisorId)) {
    return planningError('SUPERVISOR_NOT_FOUND', 'Ressource terrain introuvable.', 404);
  }

  const normalizedTargetProgress = targetQuantity !== null && targetQuantity > 0 ? null : targetProgress;

  return {
    date,
    supervisorId,
    projectId,
    action,
    plannedZone,
    targetProgress: normalizedTargetProgress,
    targetQuantity,
    targetUnit,
    objectiveText,
    plannedDurationMinutes,
  };
}

async function validateNegotiationAssignmentInput(prisma: PrismaClient, user: AuthLikeUser, input: CreateAssignmentRequest) {
  const date = parsePlanningDate(input.date);
  if (!date) {
    return planningError('INVALID_DATE', 'Date invalide.', 400);
  }

  const rangeError = validateDateWindow(date);
  if (rangeError) return rangeError;

  const supervisorId = normalizeId(input.supervisorId);
  const projectId = normalizeId(input.projectId);
  const zoneId = normalizeId(input.zoneId);
  const action = normalizeOptionalAction(input.action);

  if (!supervisorId || !projectId) {
    return planningError('INVALID_REQUEST', 'Ressource et projet sont requis pour une tache nego.', 400);
  }

  const [project, zone, zoneCount, supervisorIds] = await Promise.all([
    prisma.project.findFirst({
      where: {
        id: projectId,
        ...operationalPlanningProjectWhere(user, date),
      },
      select: { id: true },
    }),
    zoneId
      ? prisma.negotiationZone.findFirst({
          where: {
            id: zoneId,
            projectId,
          },
          select: { id: true, name: true },
        })
      : Promise.resolve(null),
    prisma.negotiationZone.count({ where: { projectId } }),
    getScopedSupervisorIds(prisma, user, date),
  ]);

  if (!project) {
    return planningError('PROJECT_NOT_FOUND', 'Projet actif introuvable ou non accessible.', 404);
  }

  if (zoneId && !zone) {
    return planningError('ZONE_NOT_FOUND', 'Zone introuvable pour ce projet.', 404);
  }

  if (!zoneId && zoneCount > 0) {
    return planningError('ZONE_REQUIRED', 'Selectionne une zone pour ce projet.', 400);
  }

  if (!supervisorIds.includes(supervisorId)) {
    return planningError('SUPERVISOR_NOT_FOUND', 'Ressource negociation introuvable.', 404);
  }

  return {
    date,
    supervisorId,
    projectId,
    zoneId: zone?.id ?? null,
    zoneName: zone?.name ?? action ?? 'Zone nego',
    action: action ?? (zone ? `Negociation - ${zone.name}` : 'Negociation'),
  };
}

async function getScopedSupervisorIds(prisma: PrismaClient, user: AuthLikeUser, _date: Date) {
  const roles = isBusinessManagerRole(user.role) ? getBusinessManagedResourceRoles(user.role) : CLASSIC_FIELD_USER_ROLES;
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

  const [assignments, freeMissions, negotiationAssignments] = await Promise.all([
    prisma.planningAssignment.findMany({
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
    }),
    prisma.freeMission.findMany({
      where: {
        date,
        deletedAt: null,
        status: { not: FreeMissionStatus.CANCELLED },
        assigneeId: {
          in: supervisorIds,
        },
      },
      select: {
        assigneeId: true,
        project: {
          select: {
            name: true,
          },
        },
      },
    }),
    prisma.negotiationAssignment.findMany({
      where: {
        date,
        deletedAt: null,
        status: { not: NegotiationAssignmentStatus.CANCELLED },
        assigneeId: {
          in: supervisorIds,
        },
      },
      select: {
        assigneeId: true,
        plannedZone: true,
        zone: {
          select: {
            name: true,
          },
        },
      },
    }),
  ]);

  const sitesBySupervisor = new Map<string, Set<string>>();

  for (const assignment of assignments) {
    const siteNames = sitesBySupervisor.get(assignment.supervisorId) ?? new Set<string>();
    siteNames.add(assignment.site.name);
    sitesBySupervisor.set(assignment.supervisorId, siteNames);
  }

  for (const mission of freeMissions) {
    const siteNames = sitesBySupervisor.get(mission.assigneeId) ?? new Set<string>();
    siteNames.add(`Mission libre - ${mission.project.name}`);
    sitesBySupervisor.set(mission.assigneeId, siteNames);
  }

  for (const assignment of negotiationAssignments) {
    const siteNames = sitesBySupervisor.get(assignment.assigneeId) ?? new Set<string>();
    siteNames.add(`Nego - ${assignment.zone?.name ?? assignment.plannedZone ?? 'Zone'}`);
    sitesBySupervisor.set(assignment.assigneeId, siteNames);
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

function normalizeProgressForQuantity(targetProgress: number | null, targetQuantity: unknown) {
  const quantity = decimalToNumber(targetQuantity);
  return quantity !== null && quantity > 0 ? null : targetProgress;
}

function buildTaskKey(
  supervisorId: string,
  siteId: string,
  action: string,
  targetProgress: number | null,
  targetQuantity: unknown,
  targetUnit: string | null,
  workLocationType: PlanningWorkLocationType,
) {
  const normalizedTargetQuantity = decimalToNumber(targetQuantity);
  const normalizedTargetProgress = normalizeProgressForQuantity(targetProgress, targetQuantity);
  return `${supervisorId}:${siteId}:${normalizeTaskActionKey(action)}:${normalizedTargetProgress ?? 'null'}:${normalizedTargetQuantity ?? 'null'}:${targetUnit ?? 'null'}:${workLocationType}`;
}

function buildFreeMissionKey(assigneeId: string, projectId: string, action: string, plannedZone?: string | null) {
  return `${assigneeId}:${projectId}:${normalizeTaskActionKey(action)}:${normalizeTaskActionKey(plannedZone ?? '')}:${PlanningWorkLocationType.FREE_MISSION}`;
}

function normalizeTaskActionKey(action: string) {
  return action.trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr-FR');
}

function normalizeSupervisorIds(input: CreateAssignmentRequest) {
  const rawIds = Array.isArray(input.supervisorIds) && input.supervisorIds.length > 0 ? input.supervisorIds : [input.supervisorId];
  const ids = rawIds
    .map((id) => normalizeId(id))
    .filter((id): id is string => Boolean(id));
  const uniqueIds = [...new Set(ids)];

  if (uniqueIds.length === 0) {
    return planningError('INVALID_REQUEST', 'Au moins une ressource terrain est requise.', 400);
  }

  return uniqueIds;
}

function withoutSupervisorIds(input: CreateAssignmentRequest): Omit<CreateAssignmentRequest, 'supervisorIds'> {
  const { supervisorIds: _supervisorIds, ...rest } = input;
  return rest;
}

function isSameTask(
  existing: {
    action: string;
    plannedZone?: string | null;
    targetProgress: number | null;
    targetQuantity?: unknown;
    targetUnit?: string | null;
    plannedDurationMinutes?: number | null;
    workLocationType: PlanningWorkLocationType;
  },
  normalized: {
    action: string;
    plannedZone?: string | null;
    targetProgress: number | null;
    targetQuantity?: unknown;
    targetUnit?: string | null;
    plannedDurationMinutes?: number | null;
    workLocationType: PlanningWorkLocationType;
  },
) {
  return (
    normalizeTaskActionKey(existing.action) === normalizeTaskActionKey(normalized.action) &&
    (existing.plannedZone ?? null) === (normalized.plannedZone ?? null) &&
    normalizeProgressForQuantity(existing.targetProgress, existing.targetQuantity) ===
      normalizeProgressForQuantity(normalized.targetProgress, normalized.targetQuantity) &&
    decimalToNumber(existing.targetQuantity) === decimalToNumber(normalized.targetQuantity) &&
    (existing.targetUnit ?? null) === (normalized.targetUnit ?? null) &&
    (existing.plannedDurationMinutes ?? null) === (normalized.plannedDurationMinutes ?? null) &&
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
      siteId: { not: null },
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
  }) as Promise<ClockInRow[]>;
}

const planningAssignmentSelect = {
  id: true,
  date: true,
  supervisorId: true,
  siteId: true,
  action: true,
  targetProgress: true,
  targetQuantity: true,
  targetUnit: true,
  objectiveText: true,
  plannedDurationMinutes: true,
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
      siteType: true,
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
  progressUpdates: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: {
      id: true,
      progress: true,
      actualQuantity: true,
      comment: true,
      blocked: true,
      completed: true,
      createdAt: true,
      createdBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  },
} satisfies Prisma.PlanningAssignmentSelect;

const taskProgressUpdateSelect = {
  id: true,
  progress: true,
  actualQuantity: true,
  comment: true,
  blocked: true,
  completed: true,
  createdAt: true,
  createdBy: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.TaskProgressUpdateSelect;

const availableSiteSelect = {
  id: true,
  name: true,
  address: true,
  siteType: true,
  requiresClockIn: true,
  status: true,
  project: {
    select: {
      id: true,
      name: true,
    },
  },
} satisfies Prisma.SiteSelect;

const supervisorAssignmentSelect = {
  id: true,
  date: true,
  siteId: true,
  action: true,
  targetProgress: true,
  targetQuantity: true,
  targetUnit: true,
  objectiveText: true,
  plannedDurationMinutes: true,
  status: true,
  workLocationType: true,
  site: {
    select: {
      name: true,
      address: true,
      siteType: true,
    },
  },
  photos: {
    where: {
      isDeleted: false,
    },
    orderBy: [{ takenAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      filename: true,
      takenAt: true,
    },
  },
  progressUpdates: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 20,
    select: taskProgressUpdateSelect,
  },
} satisfies Prisma.PlanningAssignmentSelect;

function serializePlanningAssignment(assignment: PlanningAssignmentRow, clockIns: ClockInRow[]): PlanningAssignment {
  const latestProgressUpdate = assignment.progressUpdates[0] ? serializeTaskProgressUpdate(assignment.progressUpdates[0]) : null;
  const targetQuantity = decimalToNumber(assignment.targetQuantity);
  const objective = buildObjectiveState(assignment.targetProgress, targetQuantity, latestProgressUpdate);

  return {
    id: assignment.id,
    supervisorId: assignment.supervisorId,
    supervisorName: assignment.supervisor.lastName,
    supervisorFirstName: assignment.supervisor.firstName,
    siteId: assignment.siteId,
    siteName: assignment.site.name,
    siteAddress: assignment.site.address,
    siteType: assignment.site.siteType,
    action: assignment.action,
    targetProgress: assignment.targetProgress,
    targetQuantity,
    targetUnit: assignment.targetUnit,
    objectiveText: assignment.objectiveText,
    plannedDurationMinutes: assignment.plannedDurationMinutes,
    actualQuantity: objective.actualQuantity,
    actualProgress: objective.actualProgress,
    progressDelta: objective.progressDelta,
    remainingQuantity: objective.remainingQuantity,
    objectiveStatus: objective.objectiveStatus,
    latestProgressUpdate,
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

function serializeSupervisorAssignment(assignment: SupervisorAssignmentRow) {
  const latestProgressUpdate = assignment.progressUpdates[0] ? serializeTaskProgressUpdate(assignment.progressUpdates[0]) : null;
  const targetQuantity = decimalToNumber(assignment.targetQuantity);
  const objective = buildObjectiveState(assignment.targetProgress, targetQuantity, latestProgressUpdate);

  return {
    id: assignment.id,
    date: formatPlanningDate(assignment.date),
    siteId: assignment.siteId,
    siteName: assignment.site.name,
    siteAddress: assignment.site.address,
    siteType: assignment.site.siteType,
    action: assignment.action,
    targetProgress: assignment.targetProgress,
    targetQuantity,
    targetUnit: assignment.targetUnit,
    objectiveText: assignment.objectiveText,
    plannedDurationMinutes: assignment.plannedDurationMinutes,
    actualQuantity: objective.actualQuantity,
    actualProgress: objective.actualProgress,
    progressDelta: objective.progressDelta,
    remainingQuantity: objective.remainingQuantity,
    objectiveStatus: objective.objectiveStatus,
    latestProgressUpdate,
    status: assignment.status,
    workLocationType: assignment.workLocationType,
    photos: assignment.photos.map((photo) => ({
      id: photo.id,
      filename: photo.filename,
      takenAt: photo.takenAt.toISOString(),
      url: createInternalPhotoUrl(photo.id),
    })),
  };
}

function serializeFreeMissionAsSupervisorAssignment(mission: Awaited<ReturnType<typeof listMyFreeMissions>>[number]) {
  const latestProgressUpdate = mission.latestProgressUpdate ?? null;
  const targetQuantity = mission.targetQuantity;
  const objective =
    mission.actualProgress !== undefined &&
    mission.actualQuantity !== undefined &&
    mission.progressDelta !== undefined &&
    mission.remainingQuantity !== undefined &&
    mission.objectiveStatus !== undefined
      ? {
          actualQuantity: mission.actualQuantity,
          actualProgress: mission.actualProgress,
          progressDelta: mission.progressDelta,
          remainingQuantity: mission.remainingQuantity,
          objectiveStatus: mission.objectiveStatus,
        }
      : buildObjectiveState(mission.targetProgress, targetQuantity, latestProgressUpdate);

  return {
    id: mission.id,
    kind: 'FREE_MISSION' as const,
    date: mission.date,
    siteId: null,
    freeMissionId: mission.id,
    projectId: mission.projectId,
    projectName: mission.projectName,
    siteName: mission.plannedZone ?? mission.action,
    zoneName: mission.plannedZone ?? mission.action,
    siteAddress: mission.projectName,
    siteType: 'FREE_MISSION' as const,
    action: mission.action,
    plannedZone: mission.plannedZone,
    targetProgress: mission.targetProgress,
    targetQuantity,
    targetUnit: mission.targetUnit,
    objectiveText: mission.objectiveText,
    plannedDurationMinutes: mission.plannedDurationMinutes,
    actualQuantity: objective.actualQuantity,
    actualProgress: objective.actualProgress,
    progressDelta: objective.progressDelta,
    remainingQuantity: objective.remainingQuantity,
    objectiveStatus: objective.objectiveStatus,
    latestProgressUpdate,
    status:
      mission.status === FreeMissionStatus.COMPLETED
        ? PlanningAssignmentStatus.COMPLETED
        : mission.status === FreeMissionStatus.IN_PROGRESS
          ? PlanningAssignmentStatus.IN_PROGRESS
          : PlanningAssignmentStatus.ASSIGNED,
    workLocationType: PlanningWorkLocationType.FREE_MISSION,
    photos: [],
  };
}

function serializeNegotiationAssignmentAsSupervisorAssignment(assignment: {
  id: string;
  projectId: string;
  zoneId: string | null;
  assigneeId: string;
  date: Date;
  plannedZone: string | null;
  instruction: string | null;
  status: NegotiationAssignmentStatus;
  project: { id: string; name: string };
  zone: { id: string; name: string } | null;
  sessions: { status: unknown }[];
}): SupervisorMyAssignment {
  const zoneName = assignment.zone?.name ?? assignment.plannedZone ?? 'Zone nego';

  return {
    id: assignment.id,
    kind: 'NEGOTIATION_ASSIGNMENT',
    date: formatPlanningDate(assignment.date),
    siteId: null,
    freeMissionId: null,
    negotiationAssignmentId: assignment.id,
    projectId: assignment.projectId,
    projectName: assignment.project.name,
    zoneId: assignment.zoneId,
    zoneName,
    siteName: zoneName,
    siteAddress: assignment.project.name,
    siteType: 'FREE_MISSION',
    action: assignment.instruction ?? `Negociation - ${zoneName}`,
    targetProgress: null,
    targetQuantity: null,
    targetUnit: null,
    objectiveText: assignment.instruction,
    plannedDurationMinutes: null,
    actualQuantity: null,
    actualProgress: null,
    progressDelta: null,
    remainingQuantity: null,
    objectiveStatus:
      assignment.status === NegotiationAssignmentStatus.COMPLETED
        ? 'ACHIEVED'
        : assignment.status === NegotiationAssignmentStatus.IN_PROGRESS
          ? 'PARTIAL'
          : 'NOT_STARTED',
    latestProgressUpdate: null,
    status:
      assignment.status === NegotiationAssignmentStatus.COMPLETED
        ? PlanningAssignmentStatus.COMPLETED
        : assignment.status === NegotiationAssignmentStatus.IN_PROGRESS
          ? PlanningAssignmentStatus.IN_PROGRESS
          : assignment.status === NegotiationAssignmentStatus.CANCELLED
            ? PlanningAssignmentStatus.CANCELLED
            : PlanningAssignmentStatus.ASSIGNED,
    workLocationType: PlanningWorkLocationType.FREE_MISSION,
    photos: [],
  };
}

function serializeFreeMissionAsPlanningAssignment(mission: Awaited<ReturnType<typeof listFreeMissions>>['missions'][number]): PlanningAssignment {
  const latestProgressUpdate = mission.latestProgressUpdate ?? null;
  const targetQuantity = mission.targetQuantity;
  const objective =
    mission.actualProgress !== undefined &&
    mission.actualQuantity !== undefined &&
    mission.progressDelta !== undefined &&
    mission.remainingQuantity !== undefined &&
    mission.objectiveStatus !== undefined
      ? {
          actualQuantity: mission.actualQuantity,
          actualProgress: mission.actualProgress,
          progressDelta: mission.progressDelta,
          remainingQuantity: mission.remainingQuantity,
          objectiveStatus: mission.objectiveStatus,
        }
      : buildObjectiveState(mission.targetProgress, targetQuantity, latestProgressUpdate);

  return {
    id: mission.id,
    kind: 'FREE_MISSION',
    supervisorId: mission.assigneeId,
    supervisorName: mission.assigneeLastName,
    supervisorFirstName: mission.assigneeFirstName,
    siteId: null,
    freeMissionId: mission.id,
    projectId: mission.projectId,
    projectName: mission.projectName,
    siteName: mission.plannedZone ?? mission.action,
    zoneName: mission.plannedZone ?? mission.action,
    siteAddress: mission.projectName,
    siteType: 'FREE_MISSION',
    action: mission.action,
    plannedZone: mission.plannedZone,
    targetProgress: mission.targetProgress,
    targetQuantity,
    targetUnit: mission.targetUnit,
    objectiveText: mission.objectiveText,
    plannedDurationMinutes: mission.plannedDurationMinutes,
    actualQuantity: objective.actualQuantity,
    actualProgress: objective.actualProgress,
    progressDelta: objective.progressDelta,
    remainingQuantity: objective.remainingQuantity,
    objectiveStatus: objective.objectiveStatus,
    latestProgressUpdate,
    assignedAt: `${mission.date}T00:00:00.000Z`,
    status:
      mission.status === FreeMissionStatus.COMPLETED
        ? PlanningAssignmentStatus.COMPLETED
        : mission.status === FreeMissionStatus.IN_PROGRESS
          ? PlanningAssignmentStatus.IN_PROGRESS
          : PlanningAssignmentStatus.ASSIGNED,
    workLocationType: PlanningWorkLocationType.FREE_MISSION,
    clockInStatus: mission.status === FreeMissionStatus.IN_PROGRESS ? 'CLOCKED_IN' : 'CLOCKED_OUT',
    createdBy: mission.createdBy,
  };
}

function serializeNegotiationAssignmentAsPlanningAssignment(assignment: {
  id: string;
  projectId: string;
  zoneId: string | null;
  assigneeId: string;
  date: Date;
  plannedZone: string | null;
  instruction: string | null;
  status: NegotiationAssignmentStatus;
  createdAt: Date;
  project: { id: string; name: string };
  zone: { id: string; name: string } | null;
  assignee: { id: string; firstName: string; lastName: string };
  createdBy: { id: string; firstName: string; lastName: string; role: Role };
  sessions: { status: unknown }[];
}): PlanningAssignment {
  const zoneName = assignment.zone?.name ?? assignment.plannedZone ?? 'Zone nego';
  const hasOpenSession = assignment.sessions.some((session) => String(session.status) === 'OPEN');

  return {
    id: assignment.id,
    kind: 'NEGOTIATION_ASSIGNMENT',
    supervisorId: assignment.assigneeId,
    supervisorName: assignment.assignee.lastName,
    supervisorFirstName: assignment.assignee.firstName,
    siteId: null,
    freeMissionId: null,
    negotiationAssignmentId: assignment.id,
    projectId: assignment.projectId,
    projectName: assignment.project.name,
    zoneId: assignment.zoneId,
    zoneName,
    siteName: zoneName,
    siteAddress: assignment.project.name,
    siteType: 'FREE_MISSION',
    action: assignment.instruction ?? `Negociation - ${zoneName}`,
    targetProgress: null,
    targetQuantity: null,
    targetUnit: null,
    objectiveText: assignment.instruction,
    plannedDurationMinutes: null,
    actualQuantity: null,
    actualProgress: null,
    progressDelta: null,
    remainingQuantity: null,
    objectiveStatus:
      assignment.status === NegotiationAssignmentStatus.COMPLETED
        ? 'ACHIEVED'
        : assignment.status === NegotiationAssignmentStatus.IN_PROGRESS
          ? 'PARTIAL'
          : 'NOT_STARTED',
    latestProgressUpdate: null,
    assignedAt: assignment.createdAt.toISOString(),
    status:
      assignment.status === NegotiationAssignmentStatus.COMPLETED
        ? PlanningAssignmentStatus.COMPLETED
        : assignment.status === NegotiationAssignmentStatus.IN_PROGRESS
          ? PlanningAssignmentStatus.IN_PROGRESS
          : assignment.status === NegotiationAssignmentStatus.CANCELLED
            ? PlanningAssignmentStatus.CANCELLED
            : PlanningAssignmentStatus.ASSIGNED,
    workLocationType: PlanningWorkLocationType.FREE_MISSION,
    clockInStatus:
      assignment.status === NegotiationAssignmentStatus.COMPLETED
        ? 'CLOCKED_OUT'
        : hasOpenSession || assignment.status === NegotiationAssignmentStatus.IN_PROGRESS
          ? 'CLOCKED_IN'
          : 'CLOCKED_OUT',
    createdBy: assignment.createdBy,
  };
}

function serializeTaskProgressUpdate(update: Prisma.TaskProgressUpdateGetPayload<{ select: typeof taskProgressUpdateSelect }>): TaskProgressUpdateItem {
  return {
    id: update.id,
    progress: update.progress,
    actualQuantity: decimalToNumber(update.actualQuantity),
    comment: update.comment,
    blocked: update.blocked,
    completed: update.completed,
    createdAt: update.createdAt.toISOString(),
    createdBy: {
      id: update.createdBy.id,
      firstName: update.createdBy.firstName,
      lastName: update.createdBy.lastName,
    },
  };
}

function buildObjectiveState(
  targetProgress: number | null,
  targetQuantity: number | null,
  latestProgressUpdate: TaskProgressUpdateItem | null,
) {
  const actualQuantity = latestProgressUpdate?.actualQuantity ?? null;
  const actualProgress = calculateActualProgress(targetQuantity, actualQuantity, latestProgressUpdate?.progress ?? null);
  const progressTarget = targetQuantity !== null && targetQuantity > 0 ? 100 : targetProgress;
  const hasQuantityObjective = targetQuantity !== null && targetQuantity > 0;
  const progressDelta = progressTarget !== null && actualProgress !== null ? actualProgress - progressTarget : null;
  const remainingQuantity =
    hasQuantityObjective && actualQuantity !== null ? Math.max(0, targetQuantity - actualQuantity) : null;
  const objectiveStatus = latestProgressUpdate?.blocked
    ? 'BLOCKED'
    : (!hasQuantityObjective && latestProgressUpdate?.completed) ||
        (hasQuantityObjective && actualQuantity !== null && actualQuantity >= targetQuantity) ||
        (!hasQuantityObjective && targetProgress !== null && actualProgress !== null && actualProgress >= targetProgress)
      ? 'ACHIEVED'
      : actualProgress !== null || actualQuantity !== null || latestProgressUpdate
        ? 'PARTIAL'
        : 'NOT_STARTED';

  return {
    actualQuantity,
    actualProgress,
    progressDelta,
    remainingQuantity,
    objectiveStatus,
  } as const;
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

function normalizeOptionalText(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed;
}

function normalizeUnit(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 24);
}

function normalizeQuantity(value: unknown): number | null | Response {
  if (value === undefined || value === null || value === '') return null;

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) {
    return planningError('INVALID_QUANTITY', 'La quantite doit etre un nombre positif.', 400);
  }

  return Math.round(numberValue * 100) / 100;
}

function normalizePlannedDurationMinutes(value: unknown): number | null | Response {
  if (value === undefined || value === null || value === '') return null;

  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    return planningError('INVALID_DURATION', 'La duree prevue doit etre un nombre entier positif.', 400);
  }

  return numberValue;
}

function normalizeTargetProgress(value: number | null | undefined): number | null | Response {
  if (value === undefined || value === null) return null;

  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 0 || numberValue > 100) {
    return planningError('INVALID_PROGRESS', 'La progression cible doit être comprise entre 0 et 100.', 400);
  }

  return numberValue;
}

function normalizeActualProgress(value: number | null | undefined): number | null | Response {
  if (value === undefined || value === null) return null;

  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue < 0 || numberValue > 100) {
    return planningError('INVALID_PROGRESS', 'La progression réalisée doit être comprise entre 0 et 100.', 400);
  }

  return numberValue;
}

function decimalToNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (!isDecimalLike(value)) return null;
  const numberValue = value.toNumber();
  return Number.isFinite(numberValue) ? numberValue : null;
}

function isDecimalLike(value: unknown): value is { toNumber: () => number } {
  return typeof value === 'object' && value !== null && typeof (value as { toNumber?: unknown }).toNumber === 'function';
}

function calculateActualProgress(
  targetQuantityValue: unknown,
  actualQuantityValue: unknown,
  fallbackProgress: number | null,
) {
  const targetQuantity = decimalToNumber(targetQuantityValue);
  const actualQuantity = decimalToNumber(actualQuantityValue);

  if (targetQuantity !== null && targetQuantity > 0 && actualQuantity !== null) {
    return Math.min(100, Math.round((actualQuantity / targetQuantity) * 100));
  }

  return fallbackProgress;
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
