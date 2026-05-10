import { GeneralSupervisorSiteScopeStatus, Role, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { FIELD_USER_ROLES } from '@/lib/field-roles';
import type {
  ResourceAssignmentsHistoryResponse,
  ResourcePlanningHistoryItem,
  ResourceTeamHistoryItem,
  ResourceTodayAssignmentItem,
} from '@/types/resource-assignments-history';

type RouteParams = {
  id: string;
};

const HISTORY_ACCESS_ROLES: Role[] = [
  Role.ADMIN,
  Role.DIRECTION,
  Role.GENERAL_SUPERVISOR,
  Role.PROJECT_MANAGER,
];

export const GET = withAuth<RouteParams>(
  async ({ user, params, req }) => {
    const filters = parseHistoryFilters(new URL(req.url).searchParams);
    const resource = await prisma.user.findFirst({
      where: {
        id: params.id,
        role: {
          in: [...FIELD_USER_ROLES],
        },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
      },
    });

    if (!resource) {
      return Response.json({ code: 'NOT_FOUND', message: 'Ressource introuvable.' }, { status: 404 });
    }

    const siteScope = buildHistorySiteScope(user.role, user.id);
    const siteFilter = buildSiteFilter(filters.projectId, filters.siteId);
    const scopedSiteWhere = mergeSiteWhere(siteScope, siteFilter);
    const teamDateWhere = buildTeamDateWhere(filters.from, filters.to);
    const planningDateWhere = buildPlanningDateWhere(filters.from, filters.to);
    const today = new Date().toISOString().slice(0, 10);

    const [scopedLinksCount, teamMemberships, planningAssignments, todayAssignments, optionSites] = await Promise.all([
      countScopedResourceLinks(resource.id, siteScope),
      prisma.teamMember.findMany({
        where: {
          userId: resource.id,
          ...teamDateWhere,
          ...(scopedSiteWhere ? { team: { site: scopedSiteWhere } } : {}),
        },
        orderBy: [{ assignmentDate: 'desc' }, { id: 'desc' }],
        select: teamMembershipSelect,
      }),
      prisma.planningAssignment.findMany({
        where: {
          supervisorId: resource.id,
          ...planningDateWhere,
          ...(scopedSiteWhere ? { site: scopedSiteWhere } : {}),
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        select: planningAssignmentSelect,
      }),
      prisma.planningAssignment.findMany({
        where: {
          supervisorId: resource.id,
          date: parseDateOnly(today),
          ...(siteScope ? { site: siteScope } : {}),
        },
        orderBy: [{ site: { project: { name: 'asc' } } }, { site: { name: 'asc' } }, { id: 'asc' }],
        select: planningAssignmentSelect,
      }),
      prisma.site.findMany({
        where: {
          ...(mergeSiteWhere(siteScope, null) ?? {}),
          OR: [
            {
              teams: {
                some: {
                  members: {
                    some: {
                      userId: resource.id,
                    },
                  },
                },
              },
            },
            {
              planningAssignments: {
                some: {
                  supervisorId: resource.id,
                },
              },
            },
          ],
        },
        orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          projectId: true,
          project: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    ]);

    if (siteScope && scopedLinksCount === 0) {
      return Response.json({ code: 'NOT_FOUND', message: 'Ressource introuvable dans votre perimetre.' }, { status: 404 });
    }

    const serializedTeams = teamMemberships.map(serializeTeamMembership);
    const serializedPlanning = planningAssignments.map(serializePlanningAssignment);
    const serializedToday = todayAssignments.map(serializeTodayAssignment);
    const options = buildOptions(optionSites);
    const response: ResourceAssignmentsHistoryResponse = {
      generatedAt: new Date().toISOString(),
      resource,
      filters,
      widgets: {
        activeTeams: serializedTeams.filter((membership) => membership.status === 'ACTIVE').length,
        inactiveTeams: serializedTeams.filter((membership) => membership.status === 'INACTIVE').length,
        planningAssignments: serializedPlanning.length,
        todayAssignments: serializedToday.length,
      },
      options,
      todayAssignments: serializedToday,
      teamMemberships: serializedTeams,
      planningAssignments: serializedPlanning,
    };

    return Response.json(response);
  },
  HISTORY_ACCESS_ROLES,
);

function buildHistorySiteScope(role: Role, userId: string): Prisma.SiteWhereInput | null {
  if (role === Role.PROJECT_MANAGER) {
    return {
      project: {
        projectManagerId: userId,
      },
    };
  }

  if (role === Role.GENERAL_SUPERVISOR) {
    return {
      generalSupervisorScopes: {
        some: {
          generalSupervisorId: userId,
          status: GeneralSupervisorSiteScopeStatus.ACTIVE,
        },
      },
    };
  }

  return null;
}

function parseHistoryFilters(searchParams: URLSearchParams) {
  const from = parseDateParam(searchParams.get('from'));
  const to = parseDateParam(searchParams.get('to'));
  const projectId = getOptionalString(searchParams.get('projectId'));
  const siteId = getOptionalString(searchParams.get('siteId'));

  return {
    from,
    to,
    projectId,
    siteId,
  };
}

function getOptionalString(value: string | null) {
  const trimmed = value?.trim() ?? '';
  return trimmed.length ? trimmed : null;
}

function parseDateParam(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = parseDateOnly(value);
  return Number.isNaN(date.getTime()) ? null : value;
}

function parseDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function buildSiteFilter(projectId: string | null, siteId: string | null): Prisma.SiteWhereInput | null {
  if (!projectId && !siteId) return null;
  return {
    ...(projectId ? { projectId } : {}),
    ...(siteId ? { id: siteId } : {}),
  };
}

function mergeSiteWhere(scope: Prisma.SiteWhereInput | null, filter: Prisma.SiteWhereInput | null): Prisma.SiteWhereInput | null {
  if (!scope && !filter) return null;
  return {
    ...(scope ?? {}),
    ...(filter ?? {}),
  };
}

function buildPlanningDateWhere(from: string | null, to: string | null): Prisma.PlanningAssignmentWhereInput {
  return {
    ...(from || to
      ? {
          date: {
            ...(from ? { gte: parseDateOnly(from) } : {}),
            ...(to ? { lte: parseDateOnly(to) } : {}),
          },
        }
      : {}),
  };
}

function buildTeamDateWhere(from: string | null, to: string | null): Prisma.TeamMemberWhereInput {
  if (!from && !to) {
    return {};
  }

  return {
    AND: [
      ...(to ? [{ assignmentDate: { lte: parseDateOnly(to) } }] : []),
      ...(from ? [{ OR: [{ endDate: null }, { endDate: { gte: parseDateOnly(from) } }] }] : []),
    ],
  };
}

async function countScopedResourceLinks(resourceId: string, siteScope: Prisma.SiteWhereInput | null) {
  if (!siteScope) return 1;

  const [teamCount, planningCount] = await Promise.all([
    prisma.teamMember.count({
      where: {
        userId: resourceId,
        team: {
          site: siteScope,
        },
      },
    }),
    prisma.planningAssignment.count({
      where: {
        supervisorId: resourceId,
        site: siteScope,
      },
    }),
  ]);

  return teamCount + planningCount;
}

function serializeTeamMembership(
  membership: Prisma.TeamMemberGetPayload<{ select: typeof teamMembershipSelect }>,
): ResourceTeamHistoryItem {
  return {
    id: membership.id,
    teamRole: membership.teamRole,
    status: membership.status,
    assignmentDate: membership.assignmentDate.toISOString().slice(0, 10),
    endDate: membership.endDate?.toISOString().slice(0, 10) ?? null,
    team: {
      id: membership.team.id,
      name: membership.team.name,
      status: membership.team.status,
    },
    site: {
      id: membership.team.site.id,
      name: membership.team.site.name,
    },
    project: membership.team.site.project,
  };
}

function serializePlanningAssignment(
  assignment: Prisma.PlanningAssignmentGetPayload<{ select: typeof planningAssignmentSelect }>,
): ResourcePlanningHistoryItem {
  return {
    ...serializeTodayAssignment(assignment),
    createdAt: assignment.createdAt.toISOString(),
  };
}

function serializeTodayAssignment(
  assignment: Prisma.PlanningAssignmentGetPayload<{ select: typeof planningAssignmentSelect }>,
): ResourceTodayAssignmentItem {
  return {
    id: assignment.id,
    date: assignment.date.toISOString().slice(0, 10),
    action: assignment.action,
    targetProgress: assignment.targetProgress,
    status: assignment.status,
    deletedAt: assignment.deletedAt?.toISOString() ?? null,
    site: {
      id: assignment.site.id,
      name: assignment.site.name,
    },
    project: assignment.site.project,
  };
}

function buildOptions(
  sites: {
    id: string;
    name: string;
    projectId: string;
    project: {
      id: string;
      name: string;
    };
  }[],
) {
  const projects = new Map<string, string>();
  sites.forEach((site) => projects.set(site.project.id, site.project.name));

  return {
    projects: [...projects.entries()].map(([id, name]) => ({ id, name })),
    sites: sites.map((site) => ({
      id: site.id,
      name: site.name,
      projectId: site.projectId,
      projectName: site.project.name,
    })),
  };
}

const teamMembershipSelect = {
  id: true,
  teamRole: true,
  assignmentDate: true,
  endDate: true,
  status: true,
  team: {
    select: {
      id: true,
      name: true,
      status: true,
      site: {
        select: {
          id: true,
          name: true,
          project: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.TeamMemberSelect;

const planningAssignmentSelect = {
  id: true,
  date: true,
  action: true,
  targetProgress: true,
  status: true,
  deletedAt: true,
  createdAt: true,
  site: {
    select: {
      id: true,
      name: true,
      project: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
} satisfies Prisma.PlanningAssignmentSelect;
