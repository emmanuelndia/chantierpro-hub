import { FreeMissionStatus, PlanningAssignmentStatus, PlanningWorkLocationType, Prisma, Role, type PrismaClient } from '@prisma/client';
import type {
  CentralizedPlanningAssignment,
  CentralizedPlanningFilters,
  CentralizedPlanningResponse,
} from '@/types/planning-web';
import type { TaskProgressUpdateItem } from '@/types/mobile-planning';
import { BUSINESS_MANAGER_ROLES } from '@/lib/field-roles';
import { listFreeMissions } from '@/lib/free-missions';

type AuthLikeUser = {
  id: string;
  role: Role;
};

const CENTRALIZED_PLANNING_ROLES: readonly Role[] = [
  ...BUSINESS_MANAGER_ROLES,
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
  Role.ADMIN,
];
const MAX_RANGE_DAYS = 31;

export function canAccessCentralizedPlanning(role: Role) {
  return CENTRALIZED_PLANNING_ROLES.includes(role);
}

export function parseCentralizedPlanningFilters(searchParams: URLSearchParams): CentralizedPlanningFilters | null {
  const today = new Date().toISOString().slice(0, 10);
  const from = sanitizeString(searchParams.get('from')) ?? today;
  const to = sanitizeString(searchParams.get('to')) ?? from;

  if (!parseDateOnly(from) || !parseDateOnly(to)) {
    return null;
  }

  return {
    from,
    to,
    projectId: sanitizeString(searchParams.get('projectId')) ?? '',
    siteId: sanitizeString(searchParams.get('siteId')) ?? '',
    resourceId: sanitizeString(searchParams.get('resourceId')) ?? '',
    role: sanitizeString(searchParams.get('role')) ?? '',
    workLocationType: sanitizeString(searchParams.get('workLocationType')) ?? '',
    projectManagerId: sanitizeString(searchParams.get('projectManagerId')) ?? '',
  };
}

export async function getCentralizedPlanning(
  prisma: PrismaClient,
  user: AuthLikeUser,
  filters: CentralizedPlanningFilters,
): Promise<CentralizedPlanningResponse | Response> {
  if (!canAccessCentralizedPlanning(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces refuse au planning centralise.' }, { status: 403 });
  }

  const from = parseDateOnly(filters.from);
  const to = parseDateOnly(filters.to);
  if (!from || !to || from > to || dayDiff(from, to) > MAX_RANGE_DAYS) {
    return Response.json({ code: 'INVALID_RANGE', message: 'Periode de planning invalide.' }, { status: 400 });
  }

  const resourceRole = parseRole(filters.role);
  const workLocationType = parseWorkLocationType(filters.workLocationType);
  if (filters.role && !resourceRole) {
    return Response.json({ code: 'INVALID_ROLE', message: 'Role ressource invalide.' }, { status: 400 });
  }
  if (filters.workLocationType && !workLocationType) {
    return Response.json({ code: 'INVALID_WORK_LOCATION', message: 'Type de tache invalide.' }, { status: 400 });
  }

  const where: Prisma.PlanningAssignmentWhereInput = {
    deletedAt: null,
    date: {
      gte: from,
      lte: to,
    },
    ...(filters.siteId ? { siteId: filters.siteId } : {}),
    ...(filters.resourceId ? { supervisorId: filters.resourceId } : {}),
    ...(workLocationType ? { workLocationType } : {}),
    ...(resourceRole ? { supervisor: { role: resourceRole } } : {}),
    site: {
      status: 'ACTIVE',
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
      ...(filters.projectManagerId ? { project: { projectManagerId: filters.projectManagerId } } : {}),
    },
  };

  const [assignments, freeMissionResponses] = await Promise.all([
    prisma.planningAssignment.findMany({
    where,
    orderBy: [
      { date: 'asc' },
      { site: { project: { name: 'asc' } } },
      { site: { name: 'asc' } },
      { supervisor: { firstName: 'asc' } },
      { supervisor: { lastName: 'asc' } },
      { id: 'asc' },
    ],
    select: {
      id: true,
      date: true,
      action: true,
      targetProgress: true,
      targetQuantity: true,
      targetUnit: true,
      objectiveText: true,
      plannedDurationMinutes: true,
      status: true,
      workLocationType: true,
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
      supervisor: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
        },
      },
      site: {
        select: {
          id: true,
          name: true,
          address: true,
          siteType: true,
          project: {
            select: {
              id: true,
              name: true,
              projectManagerId: true,
              projectManager: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
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
    },
    }),
    Promise.all(
      eachDate(from, to).map((date) => listFreeMissions(prisma, user, date.toISOString().slice(0, 10))),
    ),
  ]);

  const freeMissionItems = freeMissionResponses
    .flatMap((response) => response.missions)
    .filter((mission) => {
      if (filters.siteId) return false;
      if (workLocationType && workLocationType !== PlanningWorkLocationType.FREE_MISSION) return false;
      if (filters.projectId && mission.projectId !== filters.projectId) return false;
      if (filters.resourceId && mission.assigneeId !== filters.resourceId) return false;
      if (resourceRole && mission.assigneeRole !== resourceRole) return false;
      if (filters.projectManagerId && mission.projectManagerId !== filters.projectManagerId) return false;
      return true;
    })
    .map((mission): CentralizedPlanningAssignment => {
      const targetQuantity = mission.targetQuantity;
      const actualProgress = mission.status === FreeMissionStatus.COMPLETED ? 100 : null;
      const objective = buildObjectiveState(mission.targetProgress, targetQuantity, null);

      return {
        id: mission.id,
        date: mission.date,
        projectId: mission.projectId,
        projectName: mission.projectName,
        projectManagerId: mission.projectManagerId,
        projectManagerName: mission.projectManagerName,
        siteId: mission.id,
        siteName: mission.plannedZone ?? mission.action,
        plannedZone: mission.plannedZone,
        siteAddress: mission.projectName,
        siteType: 'FREE_MISSION',
        resourceId: mission.assigneeId,
        resourceName: mission.assigneeName,
        resourceRole: mission.assigneeRole,
        action: mission.action,
        targetProgress: mission.targetProgress,
        targetQuantity,
        targetUnit: mission.targetUnit,
        objectiveText: mission.objectiveText,
        plannedDurationMinutes: mission.plannedDurationMinutes,
        actualQuantity: null,
        actualProgress,
        progressDelta: actualProgress !== null ? actualProgress - (targetQuantity && targetQuantity > 0 ? 100 : mission.targetProgress ?? 0) : objective.progressDelta,
        remainingQuantity: objective.remainingQuantity,
        objectiveStatus:
          mission.status === FreeMissionStatus.COMPLETED
            ? 'ACHIEVED'
            : mission.status === FreeMissionStatus.IN_PROGRESS
              ? 'PARTIAL'
              : 'NOT_STARTED',
        latestProgressUpdate: null,
        status:
          mission.status === FreeMissionStatus.COMPLETED
            ? PlanningAssignmentStatus.COMPLETED
            : mission.status === FreeMissionStatus.IN_PROGRESS
              ? PlanningAssignmentStatus.IN_PROGRESS
              : PlanningAssignmentStatus.ASSIGNED,
        workLocationType: PlanningWorkLocationType.FREE_MISSION,
        createdBy: {
          id: mission.createdBy.id,
          name: `${mission.createdBy.firstName} ${mission.createdBy.lastName}`.trim(),
          role: mission.createdBy.role,
        },
        canEdit: false,
      };
    });

  return {
    generatedAt: new Date().toISOString(),
    from: filters.from,
    to: filters.to,
    items: [
      ...assignments.map((assignment): CentralizedPlanningAssignment => {
      const latestProgressUpdate = assignment.progressUpdates[0] ? serializeTaskProgressUpdate(assignment.progressUpdates[0]) : null;
      const targetQuantity = decimalToNumber(assignment.targetQuantity);
      const objective = buildObjectiveState(assignment.targetProgress, targetQuantity, latestProgressUpdate);

      return {
        id: assignment.id,
        date: assignment.date.toISOString().slice(0, 10),
        projectId: assignment.site.project.id,
        projectName: assignment.site.project.name,
        projectManagerId: assignment.site.project.projectManagerId,
        projectManagerName: `${assignment.site.project.projectManager.firstName} ${assignment.site.project.projectManager.lastName}`.trim(),
        siteId: assignment.site.id,
        siteName: assignment.site.name,
        siteAddress: assignment.site.address,
        siteType: assignment.site.siteType,
        resourceId: assignment.supervisor.id,
        resourceName: `${assignment.supervisor.firstName} ${assignment.supervisor.lastName}`.trim(),
        resourceRole: assignment.supervisor.role,
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
        createdBy: {
          id: assignment.createdBy.id,
          name: `${assignment.createdBy.firstName} ${assignment.createdBy.lastName}`.trim(),
          role: assignment.createdBy.role,
        },
        canEdit:
          user.role === Role.PROJECT_MANAGER
            ? assignment.site.project.projectManagerId === user.id
            : false,
      };
      }),
      ...freeMissionItems,
    ].sort(compareCentralizedItems),
  };
}

function compareCentralizedItems(left: CentralizedPlanningAssignment, right: CentralizedPlanningAssignment) {
  return (
    left.date.localeCompare(right.date) ||
    left.projectName.localeCompare(right.projectName) ||
    left.siteName.localeCompare(right.siteName) ||
    left.resourceName.localeCompare(right.resourceName) ||
    left.id.localeCompare(right.id)
  );
}

function eachDate(from: Date, to: Date) {
  const dates: Date[] = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function serializeTaskProgressUpdate(update: {
  id: string;
  progress: number | null;
  actualQuantity: unknown;
  comment: string | null;
  blocked: boolean;
  completed: boolean;
  createdAt: Date;
  createdBy: {
    id: string;
    firstName: string;
    lastName: string;
  };
}): TaskProgressUpdateItem {
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

  return { actualQuantity, actualProgress, progressDelta, remainingQuantity, objectiveStatus } as const;
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

function parseDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayDiff(from: Date, to: Date) {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

function parseRole(value: string) {
  if (!value) return null;
  return Object.values(Role).includes(value as Role) ? (value as Role) : null;
}

function parseWorkLocationType(value: string) {
  if (!value) return null;
  return Object.values(PlanningWorkLocationType).includes(value as PlanningWorkLocationType)
    ? (value as PlanningWorkLocationType)
    : null;
}

function sanitizeString(value: string | null) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}
