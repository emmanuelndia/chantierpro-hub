import { Role, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { FIELD_USER_ROLES } from '@/lib/field-roles';

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
  async ({ user, params }) => {
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
    const [teamMemberships, planningAssignments] = await Promise.all([
      prisma.teamMember.findMany({
        where: {
          userId: resource.id,
          ...(siteScope ? { team: { site: siteScope } } : {}),
        },
        orderBy: [{ assignmentDate: 'desc' }, { id: 'desc' }],
        select: {
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
        },
      }),
      prisma.planningAssignment.findMany({
        where: {
          supervisorId: resource.id,
          ...(siteScope ? { site: siteScope } : {}),
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        select: {
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
        },
      }),
    ]);

    return Response.json({
      resource,
      teamMemberships: teamMemberships.map((membership) => ({
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
      })),
      planningAssignments: planningAssignments.map((assignment) => ({
        id: assignment.id,
        date: assignment.date.toISOString().slice(0, 10),
        action: assignment.action,
        targetProgress: assignment.targetProgress,
        status: assignment.status,
        deletedAt: assignment.deletedAt?.toISOString() ?? null,
        createdAt: assignment.createdAt.toISOString(),
        site: {
          id: assignment.site.id,
          name: assignment.site.name,
        },
        project: assignment.site.project,
      })),
    });
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

  return null;
}
