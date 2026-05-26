import { PlanningWorkLocationType, Prisma, Role, type PrismaClient } from '@prisma/client';
import type {
  CentralizedPlanningAssignment,
  CentralizedPlanningFilters,
  CentralizedPlanningResponse,
} from '@/types/planning-web';
import type { TaskProgressUpdateItem } from '@/types/mobile-planning';

type AuthLikeUser = {
  id: string;
  role: Role;
};

const CENTRALIZED_PLANNING_ROLES: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION, Role.ADMIN];
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
    },
  };

  const assignments = await prisma.planningAssignment.findMany({
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
      objectiveText: true,
      status: true,
      workLocationType: true,
      progressUpdates: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: {
          id: true,
          progress: true,
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
          project: {
            select: {
              id: true,
              name: true,
              projectManagerId: true,
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
  });

  return {
    generatedAt: new Date().toISOString(),
    from: filters.from,
    to: filters.to,
    items: assignments.map((assignment): CentralizedPlanningAssignment => {
      const latestProgressUpdate = assignment.progressUpdates[0] ? serializeTaskProgressUpdate(assignment.progressUpdates[0]) : null;
      const objective = buildObjectiveState(assignment.targetProgress, latestProgressUpdate);

      return {
        id: assignment.id,
        date: assignment.date.toISOString().slice(0, 10),
        projectId: assignment.site.project.id,
        projectName: assignment.site.project.name,
        siteId: assignment.site.id,
        siteName: assignment.site.name,
        siteAddress: assignment.site.address,
        resourceId: assignment.supervisor.id,
        resourceName: `${assignment.supervisor.firstName} ${assignment.supervisor.lastName}`.trim(),
        resourceRole: assignment.supervisor.role,
        action: assignment.action,
        targetProgress: assignment.targetProgress,
        objectiveText: assignment.objectiveText,
        actualProgress: objective.actualProgress,
        progressDelta: objective.progressDelta,
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
  };
}

function serializeTaskProgressUpdate(update: {
  id: string;
  progress: number | null;
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

function buildObjectiveState(targetProgress: number | null, latestProgressUpdate: TaskProgressUpdateItem | null) {
  const actualProgress = latestProgressUpdate?.progress ?? null;
  const progressDelta = targetProgress !== null && actualProgress !== null ? actualProgress - targetProgress : null;
  const objectiveStatus = latestProgressUpdate?.blocked
    ? 'BLOCKED'
    : latestProgressUpdate?.completed || (targetProgress !== null && actualProgress !== null && actualProgress >= targetProgress)
      ? 'ACHIEVED'
      : actualProgress !== null || latestProgressUpdate
        ? 'PARTIAL'
        : 'NOT_STARTED';

  return { actualProgress, progressDelta, objectiveStatus } as const;
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
