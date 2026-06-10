import { PlanningAssignmentStatus, ProjectStatus, SiteStatus, type Prisma, type PrismaClient, type Role } from '@prisma/client';
import { projectAccessWhere } from '@/lib/projects';
import type { ProjectProgressItem, ProjectProgressResponse, ProjectProgressStatus } from '@/types/project-progress';

type AuthLikeUser = {
  id: string;
  role: Role;
};

const progressAllowedRoles: readonly Role[] = ['HR', 'PROJECT_MANAGER', 'DIRECTION', 'ADMIN'];

const projectProgressSelect = {
  id: true,
  name: true,
  status: true,
  startDate: true,
  endDate: true,
  projectManager: {
    select: {
      firstName: true,
      lastName: true,
    },
  },
  sites: {
    select: {
      id: true,
      status: true,
      endDate: true,
      planningAssignments: {
        where: {
          deletedAt: null,
        },
        select: {
          id: true,
          date: true,
          targetProgress: true,
          targetQuantity: true,
          plannedDurationMinutes: true,
          status: true,
          progressUpdates: {
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: {
              progress: true,
              actualQuantity: true,
              blocked: true,
              completed: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ProjectSelect;

type ProjectProgressRow = Prisma.ProjectGetPayload<{ select: typeof projectProgressSelect }>;
type AssignmentRow = ProjectProgressRow['sites'][number]['planningAssignments'][number];

export function canAccessProjectProgress(role: Role) {
  return progressAllowedRoles.includes(role);
}

export async function getProjectProgress(prisma: PrismaClient, user: AuthLikeUser): Promise<ProjectProgressResponse> {
  const projects = await prisma.project.findMany({
    where: projectAccessWhere(user),
    orderBy: [{ endDate: 'asc' }, { name: 'asc' }],
    select: projectProgressSelect,
  });

  const items = projects.map((project) => buildProjectProgressItem(project));
  const averageProgress = items.length === 0 ? 0 : Math.round(items.reduce((sum, item) => sum + item.globalProgress, 0) / items.length);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      projects: items.length,
      lateProjects: items.filter((item) => item.progressStatus === 'LATE').length,
      atRiskProjects: items.filter((item) => item.progressStatus === 'AT_RISK').length,
      averageProgress,
      blockedTasks: items.reduce((sum, item) => sum + item.tasks.blocked, 0),
    },
    items,
  };
}

function buildProjectProgressItem(project: ProjectProgressRow): ProjectProgressItem {
  const today = startOfToday();
  const assignments = project.sites.flatMap((site) => site.planningAssignments);
  const taskStats = buildTaskStats(assignments, today);
  const completedSites = project.sites.filter((site) => site.status === SiteStatus.COMPLETED).length;
  const activeSites = project.sites.filter((site) => site.status === SiteStatus.ACTIVE).length;
  const lateSites = project.sites.filter((site) => site.endDate && site.endDate < today && site.status !== SiteStatus.COMPLETED).length;
  const siteProgress = project.sites.length === 0 ? 0 : Math.round((completedSites / project.sites.length) * 100);
  const taskProgress = taskStats.total === 0 ? siteProgress : Math.round((taskStats.achieved / taskStats.total) * 100);
  const globalProgress = taskStats.total > 0 && project.sites.length > 0 ? Math.round((taskProgress * 0.7) + (siteProgress * 0.3)) : Math.max(taskProgress, siteProgress);
  const projectDateLate = Boolean(project.endDate && project.endDate < today && project.status !== ProjectStatus.COMPLETED);
  const alerts = buildAlerts({ projectDateLate, lateSites, taskStats, globalProgress });
  const progressStatus = getProgressStatus(project.status, projectDateLate, lateSites, taskStats, globalProgress);

  return {
    projectId: project.id,
    projectName: project.name,
    projectManagerName: `${project.projectManager.firstName} ${project.projectManager.lastName}`,
    status: project.status,
    startDate: project.startDate.toISOString().slice(0, 10),
    endDate: project.endDate?.toISOString().slice(0, 10) ?? null,
    globalProgress,
    progressStatus,
    alerts,
    sites: {
      total: project.sites.length,
      active: activeSites,
      completed: completedSites,
      late: lateSites,
    },
    tasks: taskStats,
  };
}

function buildTaskStats(assignments: AssignmentRow[], today: Date) {
  return assignments.reduce(
    (stats, assignment) => {
      const state = getAssignmentObjectiveState(assignment);
      stats.total += 1;
      stats.plannedDurationMinutes += assignment.plannedDurationMinutes ?? 0;

      if (state === 'ACHIEVED') stats.achieved += 1;
      if (state === 'PARTIAL') stats.partial += 1;
      if (state === 'BLOCKED') stats.blocked += 1;
      if (state === 'NOT_STARTED') stats.notStarted += 1;
      if (assignment.date < today && state !== 'ACHIEVED') stats.late += 1;

      return stats;
    },
    {
      total: 0,
      achieved: 0,
      partial: 0,
      blocked: 0,
      notStarted: 0,
      late: 0,
      plannedDurationMinutes: 0,
    },
  );
}

function getAssignmentObjectiveState(assignment: AssignmentRow) {
  const update = assignment.progressUpdates[0] ?? null;
  if (update?.blocked) return 'BLOCKED';
  if (assignment.status === PlanningAssignmentStatus.COMPLETED || update?.completed) return 'ACHIEVED';

  const targetQuantity = assignment.targetQuantity?.toNumber() ?? null;
  const actualQuantity = update?.actualQuantity?.toNumber() ?? null;
  if (targetQuantity !== null && targetQuantity > 0) {
    if (actualQuantity !== null && actualQuantity >= targetQuantity) return 'ACHIEVED';
    if (actualQuantity !== null && actualQuantity > 0) return 'PARTIAL';
    return 'NOT_STARTED';
  }

  const progress = update?.progress ?? null;
  const targetProgress = assignment.targetProgress ?? 100;
  if (progress !== null && progress >= targetProgress) return 'ACHIEVED';
  if (progress !== null && progress > 0) return 'PARTIAL';
  if (assignment.status === PlanningAssignmentStatus.IN_PROGRESS) return 'PARTIAL';
  return 'NOT_STARTED';
}

function getProgressStatus(
  projectStatus: ProjectStatus,
  projectDateLate: boolean,
  lateSites: number,
  taskStats: ReturnType<typeof buildTaskStats>,
  globalProgress: number,
): ProjectProgressStatus {
  if (projectStatus === ProjectStatus.COMPLETED || globalProgress >= 100) return 'COMPLETED';
  if (projectDateLate || lateSites > 0 || taskStats.late > 0) return 'LATE';
  if (taskStats.blocked > 0 || globalProgress < 50) return 'AT_RISK';
  return 'ON_TRACK';
}

function buildAlerts({
  projectDateLate,
  lateSites,
  taskStats,
  globalProgress,
}: {
  projectDateLate: boolean;
  lateSites: number;
  taskStats: ReturnType<typeof buildTaskStats>;
  globalProgress: number;
}) {
  const alerts: string[] = [];
  if (projectDateLate) alerts.push('Date de fin projet dépassée');
  if (lateSites > 0) alerts.push(`${lateSites} chantier(s) en retard`);
  if (taskStats.late > 0) alerts.push(`${taskStats.late} tâche(s) en retard`);
  if (taskStats.blocked > 0) alerts.push(`${taskStats.blocked} tâche(s) bloquée(s)`);
  if (globalProgress < 50 && taskStats.total > 0) alerts.push('Progression faible');
  return alerts;
}

function startOfToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
