import {
  GeneralSupervisorSiteScopeStatus,
  Prisma,
  Role,
  SiteStatus,
  TeamMemberStatus,
  TeamRole,
  TeamStatus,
  type PrismaClient,
} from '@prisma/client';
import { EXTERNAL_TEAM_RESOURCE_ROLES } from '@/lib/field-roles';
import {
  jsonTeamError,
  parseAddTeamMemberInput,
  parseCreateTeamInput,
  parseUpdateTeamInput,
  serializeTeam,
  serializeTeamMember,
  serializeUnassignedUser,
  softDeleteTeamMember,
  syncTeamLeadMembership,
  teamMemberPublicSelect,
  teamPublicSelect,
  upsertActiveTeamMember,
  validateActiveTechnician,
} from '@/lib/teams';
import { projectAccessWhere } from '@/lib/projects';
import type {
  WebTeamDetailResponse,
  WebTeamFormOptionsResponse,
  WebTeamItem,
  WebTeamsResponse,
  WebTeamStatusFilter,
} from '@/types/web-teams';

type AuthLikeUser = {
  id: string;
  role: Role;
};

type WebTeamsFilters = {
  projectId?: string | null;
  siteId?: string | null;
  status?: WebTeamStatusFilter | null;
  q?: string | null;
};

type WebTeamRow = Prisma.TeamGetPayload<{ select: typeof webTeamSelect }>;

const WEB_TEAM_ROLES: readonly Role[] = [
  Role.GENERAL_SUPERVISOR,
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
  Role.ADMIN,
];

export function canAccessWebTeams(role: Role) {
  return WEB_TEAM_ROLES.includes(role);
}

export function webSiteWhereForTeams(user: AuthLikeUser): Prisma.SiteWhereInput {
  if (user.role === Role.PROJECT_MANAGER) {
    return {
      project: projectAccessWhere(user),
    };
  }

  if (user.role === Role.GENERAL_SUPERVISOR) {
    return {
      project: projectAccessWhere(user),
      status: SiteStatus.ACTIVE,
      OR: [
        {
          generalSupervisorScopes: {
            some: {
              generalSupervisorId: user.id,
              status: GeneralSupervisorSiteScopeStatus.ACTIVE,
            },
          },
        },
        {
          project: {
            generalSupervisorProjectScopes: {
              some: {
                generalSupervisorId: user.id,
                status: GeneralSupervisorSiteScopeStatus.ACTIVE,
              },
            },
          },
        },
      ],
    };
  }

  return {
    project: projectAccessWhere(user),
  };
}

export function webTeamWhere(user: AuthLikeUser): Prisma.TeamWhereInput {
  return {
    site: webSiteWhereForTeams(user),
  };
}

export async function getWebTeams(
  prisma: PrismaClient,
  user: AuthLikeUser,
  filters: WebTeamsFilters = {},
): Promise<WebTeamsResponse | Response> {
  if (!canAccessWebTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, 'Acces refuse aux equipes web.');
  }

  const status = normalizeStatus(filters.status ?? null);
  const query = filters.q?.trim() ?? '';
  const projectId = filters.projectId?.trim() ? filters.projectId.trim() : null;
  const siteId = filters.siteId?.trim() ? filters.siteId.trim() : null;
  const siteBaseWhere = webSiteWhereForTeams(user);

  const where: Prisma.TeamWhereInput = {
    ...webTeamWhere(user),
    ...(status ? { status } : {}),
    ...(siteId ? { siteId } : {}),
    ...(projectId ? { site: { ...siteBaseWhere, projectId } } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { teamLead: { firstName: { contains: query, mode: 'insensitive' } } },
            { teamLead: { lastName: { contains: query, mode: 'insensitive' } } },
            { site: { name: { contains: query, mode: 'insensitive' } } },
            { site: { project: { name: { contains: query, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };

  const [teams, projects, sites] = await Promise.all([
    prisma.team.findMany({
      where,
      orderBy: [{ site: { project: { name: 'asc' } } }, { site: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
      select: webTeamSelect,
    }),
    prisma.project.findMany({
      where: {
        sites: {
          some: siteBaseWhere,
        },
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    prisma.site.findMany({
      where: siteBaseWhere,
      select: {
        id: true,
        name: true,
        projectId: true,
        project: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
    }),
  ]);

  const items = teams.map(serializeWebTeam);

  return {
    generatedAt: new Date().toISOString(),
    widgets: {
      total: items.length,
      active: items.filter((team) => team.status === TeamStatus.ACTIVE).length,
      inactive: items.filter((team) => team.status === TeamStatus.INACTIVE).length,
      members: items.reduce((total, team) => total + team.activeMembersCount, 0),
    },
    projects,
    sites: sites.map((site) => ({
      id: site.id,
      name: site.name,
      projectId: site.projectId,
      projectName: site.project.name,
    })),
    teams: items,
  };
}

export async function getWebTeamFormOptions(
  prisma: PrismaClient,
  user: AuthLikeUser,
): Promise<WebTeamFormOptionsResponse | Response> {
  if (!canAccessWebTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, 'Acces refuse aux options equipe web.');
  }

  const siteWhere = webSiteWhereForTeams(user);
  const [sites, users] = await Promise.all([
    prisma.site.findMany({
      where: siteWhere,
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
      orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
    }),
    prisma.user.findMany({
      where: assignableUserWhere(),
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
    }),
  ]);

  const projects = new Map<string, { id: string; name: string }>();
  sites.forEach((site) => projects.set(site.project.id, site.project));

  return {
    projects: [...projects.values()],
    sites: sites.map((site) => ({
      id: site.id,
      name: site.name,
      projectId: site.projectId,
      projectName: site.project.name,
    })),
    teamLeads: users,
  };
}

export async function getWebTeamDetail(
  prisma: PrismaClient,
  user: AuthLikeUser,
  teamId: string,
): Promise<WebTeamDetailResponse | Response> {
  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
      ...webTeamWhere(user),
    },
    select: webTeamSelect,
  });

  if (!team) {
    return jsonTeamError('NOT_FOUND', 404, 'Equipe introuvable.');
  }

  const members = team.members.map(serializeWebMember);

  return {
    generatedAt: new Date().toISOString(),
    team: serializeWebTeam(team),
    activeMembers: members.filter((member) => member.status === TeamMemberStatus.ACTIVE),
    inactiveMembers: members.filter((member) => member.status === TeamMemberStatus.INACTIVE),
    availableMembers: await listWebAssignableUsers(prisma, team.id),
  };
}

export async function createWebTeam(prisma: PrismaClient, user: AuthLikeUser, body: unknown) {
  const siteId = getStringField(body, 'siteId');
  if (!siteId) {
    return jsonTeamError('BAD_REQUEST', 400, 'Le chantier est requis.');
  }

  const site = await getScopedWebSiteForTeams(prisma, siteId, user);
  if (!site) {
    return jsonTeamError('NOT_FOUND', 404, 'Chantier introuvable.');
  }

  const input = parseCreateTeamInput(body);
  if (!input) {
    return jsonTeamError('BAD_REQUEST', 400, "Le payload d'equipe est invalide.");
  }

  const leaderIsValid = await validateActiveTechnician(prisma, input.teamLeadId);
  if (!leaderIsValid) {
    return jsonTeamError('INVALID_TEAM_LEAD', 400, "Le chef d'equipe selectionne doit etre une ressource externe active.");
  }

  const team = await prisma.$transaction(async (tx) => {
    const created = await tx.team.create({
      data: {
        name: input.name,
        siteId: site.id,
        teamLeadId: input.teamLeadId,
        status: input.status ?? TeamStatus.ACTIVE,
        createdById: user.id,
      },
      select: { id: true },
    });

    await syncTeamLeadMembership(tx, {
      teamId: created.id,
      teamLeadId: input.teamLeadId,
      createdById: user.id,
    });

    return tx.team.findUniqueOrThrow({
      where: { id: created.id },
      select: teamPublicSelect,
    });
  });

  return { team: serializeTeam(team) };
}

export async function updateWebTeam(prisma: PrismaClient, user: AuthLikeUser, teamId: string, body: unknown) {
  const existingTeam = await prisma.team.findFirst({
    where: {
      id: teamId,
      ...webTeamWhere(user),
    },
    select: teamPublicSelect,
  });

  if (!existingTeam) {
    return jsonTeamError('NOT_FOUND', 404, 'Equipe introuvable.');
  }

  const input = parseUpdateTeamInput(body);
  if (!input) {
    return jsonTeamError('BAD_REQUEST', 400, "Le payload d'equipe est invalide.");
  }

  const teamLeadId = input.teamLeadId ?? existingTeam.teamLeadId;
  const leaderIsValid = teamLeadId === existingTeam.teamLeadId || (await validateActiveTechnician(prisma, teamLeadId));
  if (!leaderIsValid) {
    return jsonTeamError('INVALID_TEAM_LEAD', 400, "Le chef d'equipe selectionne doit etre une ressource externe active.");
  }

  const team = await prisma.$transaction(async (tx) => {
    await tx.team.update({
      where: { id: teamId },
      data: {
        name: input.name ?? existingTeam.name,
        teamLeadId,
        status: input.status ?? existingTeam.status,
      },
    });

    if (teamLeadId !== existingTeam.teamLeadId) {
      await syncTeamLeadMembership(tx, {
        teamId,
        teamLeadId,
        createdById: user.id,
      });
    }

    return tx.team.findUniqueOrThrow({
      where: { id: teamId },
      select: teamPublicSelect,
    });
  });

  return { team: serializeTeam(team) };
}

export async function addWebTeamMember(prisma: PrismaClient, user: AuthLikeUser, teamId: string, body: unknown) {
  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
      ...webTeamWhere(user),
    },
    select: teamPublicSelect,
  });

  if (!team) {
    return jsonTeamError('NOT_FOUND', 404, 'Equipe introuvable.');
  }

  const input = parseAddTeamMemberInput(body);
  if (!input) {
    return jsonTeamError('BAD_REQUEST', 400, 'Le payload membre est invalide.');
  }

  const memberIsValid = await validateActiveTechnician(prisma, input.userId);
  if (!memberIsValid) {
    return jsonTeamError('INVALID_MEMBER', 400, 'Le membre selectionne doit etre une ressource externe active.');
  }

  const result = await prisma.$transaction(async (tx) => {
    const upserted = await upsertActiveTeamMember(tx, {
      teamId: team.id,
      userId: input.userId,
      teamRole: input.teamRole,
      createdById: user.id,
    });

    if (upserted.status === 'active_exists') {
      return upserted;
    }

    if (input.teamRole !== TeamRole.TEAM_LEAD) {
      return upserted;
    }

    await tx.team.update({
      where: { id: team.id },
      data: { teamLeadId: input.userId },
    });

    await syncTeamLeadMembership(tx, {
      teamId: team.id,
      teamLeadId: input.userId,
      createdById: user.id,
    });

    const member = await tx.teamMember.findFirstOrThrow({
      where: {
        teamId: team.id,
        userId: input.userId,
        status: TeamMemberStatus.ACTIVE,
      },
      orderBy: [{ assignmentDate: 'desc' }, { id: 'desc' }],
      select: teamMemberPublicSelect,
    });

    return { ...upserted, member };
  });

  if (result.status === 'active_exists') {
    return jsonTeamError('CONFLICT', 409, 'Cet utilisateur est deja membre actif de cette equipe.');
  }

  return { member: serializeTeamMember(result.member), reactivated: result.status === 'reactivated' };
}

export async function removeWebTeamMember(prisma: PrismaClient, user: AuthLikeUser, teamId: string, userId: string) {
  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
      ...webTeamWhere(user),
    },
    select: {
      id: true,
      teamLeadId: true,
    },
  });

  if (!team) {
    return jsonTeamError('NOT_FOUND', 404, 'Equipe introuvable.');
  }

  if (team.teamLeadId === userId) {
    return jsonTeamError('TEAM_LEAD_REMOVAL_FORBIDDEN', 400, "Impossible de retirer le chef d'equipe actif sans definir un nouveau leader.");
  }

  const deleted = await prisma.$transaction((tx) => softDeleteTeamMember(tx, { teamId: team.id, userId }));
  if (!deleted) {
    return jsonTeamError('NOT_FOUND', 404, 'Membre actif introuvable dans cette equipe.');
  }

  return new Response(null, { status: 204 });
}

function getScopedWebSiteForTeams(prisma: PrismaClient, siteId: string, user: AuthLikeUser) {
  return prisma.site.findFirst({
    where: {
      id: siteId,
      ...webSiteWhereForTeams(user),
    },
    select: {
      id: true,
      projectId: true,
      name: true,
    },
  });
}

async function listWebAssignableUsers(prisma: PrismaClient, teamId: string) {
  const users = await prisma.user.findMany({
    where: {
      ...assignableUserWhere(),
      NOT: {
        teamMemberships: {
          some: {
            teamId,
            status: TeamMemberStatus.ACTIVE,
          },
        },
      },
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      contact: true,
    },
  });

  return users.map(serializeUnassignedUser);
}

function serializeWebTeam(team: WebTeamRow): WebTeamItem {
  const activeMembersCount = team.members.filter((member) => member.status === TeamMemberStatus.ACTIVE).length;
  const inactiveMembersCount = team.members.filter((member) => member.status === TeamMemberStatus.INACTIVE).length;

  return {
    id: team.id,
    name: team.name,
    status: team.status,
    siteId: team.siteId,
    siteName: team.site.name,
    projectId: team.site.projectId,
    projectName: team.site.project.name,
    teamLeadId: team.teamLeadId,
    teamLeadName: `${team.teamLead.firstName} ${team.teamLead.lastName}`,
    activeMembersCount,
    inactiveMembersCount,
  };
}

function serializeWebMember(member: WebTeamRow['members'][number]) {
  return {
    id: member.id,
    userId: member.userId,
    firstName: member.user.firstName,
    lastName: member.user.lastName,
    role: member.user.role,
    teamRole: member.teamRole,
    status: member.status,
    assignmentDate: member.assignmentDate.toISOString(),
    endDate: member.endDate?.toISOString() ?? null,
  };
}

function assignableUserWhere(): Prisma.UserWhereInput {
  return {
    isActive: true,
    role: {
      in: [...EXTERNAL_TEAM_RESOURCE_ROLES],
    },
  };
}

function normalizeStatus(status: WebTeamStatusFilter | null) {
  if (!status || status === 'ALL') return null;
  return status;
}

function getStringField(body: unknown, key: string) {
  if (typeof body !== 'object' || body === null || !(key in body)) {
    return null;
  }

  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const webTeamSelect = {
  id: true,
  name: true,
  status: true,
  siteId: true,
  teamLeadId: true,
  teamLead: {
    select: {
      firstName: true,
      lastName: true,
    },
  },
  site: {
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
  },
  members: {
    orderBy: [{ status: 'asc' }, { assignmentDate: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      userId: true,
      teamRole: true,
      assignmentDate: true,
      endDate: true,
      status: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
          role: true,
        },
      },
    },
  },
} satisfies Prisma.TeamSelect;
