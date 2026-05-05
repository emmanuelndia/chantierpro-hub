import {
  Role,
  TeamMemberStatus,
  TeamRole,
  TeamStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  serializeTeam,
  teamAccessWhere,
  teamPublicSelect,
} from '@/lib/teams';
import type {
  MobileTeamDetailResponse,
  MobileTeamFormOptionsResponse,
  MobileTeamManagementItem,
  MobileTeamsManagementResponse,
  MobileTeamStatusFilter,
} from '@/types/mobile-teams';
import type { UnassignedUserItem } from '@/types/teams';

type AuthLikeUser = {
  id: string;
  role: Role;
};

type MobileTeamsFilters = {
  projectId?: string | null;
  siteId?: string | null;
  status?: MobileTeamStatusFilter | null;
  q?: string | null;
};

type TeamManagementRow = {
  id: string;
  name: string;
  status: TeamStatus;
  siteId: string;
  teamLeadId: string;
  teamLead: {
    firstName: string;
    lastName: string;
  };
  site: {
    id: string;
    name: string;
    projectId: string;
    project: {
      id: string;
      name: string;
    };
  };
  members: {
    id: string;
    userId: string;
    teamRole: TeamRole;
    assignmentDate: Date;
    status: TeamMemberStatus;
    user: {
      firstName: string;
      lastName: string;
      role: Role;
    };
  }[];
};

const MOBILE_TEAM_READ_ROLES: readonly Role[] = [
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
];

const MOBILE_TEAM_MUTATE_ROLES: readonly Role[] = [
  Role.GENERAL_SUPERVISOR,
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
];

export function canAccessMobileTeams(role: Role) {
  return MOBILE_TEAM_READ_ROLES.includes(role);
}

export function canMutateMobileTeams(role: Role) {
  return MOBILE_TEAM_MUTATE_ROLES.includes(role);
}

export function mobileTeamWhere(user: AuthLikeUser): Prisma.TeamWhereInput {
  if (user.role === Role.PROJECT_MANAGER) {
    return teamAccessWhere(user);
  }

  if (user.role === Role.COORDINATOR || user.role === Role.GENERAL_SUPERVISOR) {
    return {
      site: {
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
      },
    };
  }

  return {};
}

export function mobileSiteWhereForTeams(user: AuthLikeUser): Prisma.SiteWhereInput {
  if (user.role === Role.PROJECT_MANAGER) {
    return {
      project: {
        projectManagerId: user.id,
      },
    };
  }

  if (user.role === Role.COORDINATOR || user.role === Role.GENERAL_SUPERVISOR) {
    return {
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
  }

  return {};
}

export async function getMobileTeamsManagement(
  prisma: PrismaClient,
  user: AuthLikeUser,
  filters: MobileTeamsFilters = {},
): Promise<MobileTeamsManagementResponse> {
  if (!canAccessMobileTeams(user.role)) {
    return emptyManagement(false);
  }

  const status = normalizeStatus(filters.status ?? null);
  const query = filters.q?.trim() ?? '';
  const rawProjectId = filters.projectId?.trim() ?? '';
  const rawSiteId = filters.siteId?.trim() ?? '';
  const projectId = rawProjectId ? rawProjectId : null;
  const siteId = rawSiteId ? rawSiteId : null;
  const baseWhere = mobileTeamWhere(user);
  const siteBaseWhere = mobileSiteWhereForTeams(user);

  const where: Prisma.TeamWhereInput = {
    ...baseWhere,
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
      select: teamManagementSelect,
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

  const items = teams.map(serializeManagementTeam);

  return {
    generatedAt: new Date().toISOString(),
    canMutate: canMutateMobileTeams(user.role),
    widgets: buildWidgets(items),
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

export async function getMobileTeamDetail(
  prisma: PrismaClient,
  user: AuthLikeUser,
  teamId: string,
): Promise<MobileTeamDetailResponse | null> {
  if (!canAccessMobileTeams(user.role)) {
    return null;
  }

  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
      ...mobileTeamWhere(user),
    },
    select: teamManagementSelect,
  });

  if (!team) {
    return null;
  }

  return {
    generatedAt: new Date().toISOString(),
    canMutate: canMutateMobileTeams(user.role),
    team: serializeManagementTeam(team),
    members: team.members.map(serializeMember),
    availableMembers: canMutateMobileTeams(user.role) ? await listMobileAssignableUsers(prisma, user, team.siteId) : [],
  };
}

export async function getMobileTeamFormOptions(
  prisma: PrismaClient,
  user: AuthLikeUser,
): Promise<MobileTeamFormOptionsResponse> {
  const siteWhere = mobileSiteWhereForTeams(user);
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
      where: mobileAssignableUserWhere(user),
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
  for (const site of sites) {
    projects.set(site.project.id, site.project);
  }

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

export async function getMobileTeamForm(
  prisma: PrismaClient,
  user: AuthLikeUser,
  teamId: string,
) {
  if (!canMutateMobileTeams(user.role)) {
    return null;
  }

  const team = await getScopedMobileTeamById(prisma, teamId, user);
  if (!team) {
    return null;
  }

  return {
    team: serializeTeam(team),
    options: await getMobileTeamFormOptions(prisma, user),
  };
}

export async function getScopedMobileTeamById(
  prisma: PrismaClient,
  teamId: string,
  user: AuthLikeUser,
) {
  return prisma.team.findFirst({
    where: {
      id: teamId,
      ...mobileTeamWhere(user),
    },
    select: teamPublicSelect,
  });
}

export async function validateMobileAssignableUserForSite(
  prisma: PrismaClient,
  user: AuthLikeUser,
  siteId: string,
  candidateUserId: string,
) {
  const candidate = await prisma.user.findFirst({
    where: {
      id: candidateUserId,
      ...mobileAssignableUserWhere(user),
    },
    select: { id: true },
  });

  if (!candidate) {
    return false;
  }

  const activeOnSite = await prisma.teamMember.findFirst({
    where: {
      userId: candidateUserId,
      status: TeamMemberStatus.ACTIVE,
      team: {
        siteId,
        status: TeamStatus.ACTIVE,
      },
    },
    select: { id: true },
  });

  return !activeOnSite;
}

async function listMobileAssignableUsers(
  prisma: PrismaClient,
  user: AuthLikeUser,
  siteId: string,
): Promise<UnassignedUserItem[]> {
  const users = await prisma.user.findMany({
    where: {
      ...mobileAssignableUserWhere(user),
      NOT: {
        teamMemberships: {
          some: {
            status: TeamMemberStatus.ACTIVE,
            team: {
              siteId,
              status: TeamStatus.ACTIVE,
            },
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

  return users.map((candidate) => ({
    id: candidate.id,
    email: candidate.email,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
    contact: candidate.contact,
  }));
}

function mobileAssignableUserWhere(user: AuthLikeUser): Prisma.UserWhereInput {
  const baseWhere: Prisma.UserWhereInput = {
    isActive: true,
    role: {
      in: [Role.SUPERVISOR, Role.COORDINATOR, Role.GENERAL_SUPERVISOR],
    },
  };

  if (user.role === Role.DIRECTION) {
    return baseWhere;
  }

  return {
    ...baseWhere,
    teamMemberships: {
      some: {
        status: TeamMemberStatus.ACTIVE,
        team: {
          status: TeamStatus.ACTIVE,
          site: mobileSiteWhereForTeams(user),
        },
      },
    },
  };
}

export async function getScopedMobileSiteForTeams(
  prisma: PrismaClient,
  siteId: string,
  user: AuthLikeUser,
) {
  return prisma.site.findFirst({
    where: {
      id: siteId,
      ...mobileSiteWhereForTeams(user),
    },
    select: {
      id: true,
      projectId: true,
      name: true,
    },
  });
}

const teamManagementSelect = {
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

function serializeManagementTeam(team: TeamManagementRow): MobileTeamManagementItem {
  const members = team.members.map(serializeMember);
  const activeMembers = members.filter((member) => member.status === TeamMemberStatus.ACTIVE);

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
    activeMembersCount: activeMembers.length,
    membersCount: members.length,
    membersPreview: activeMembers.slice(0, 6),
  };
}

function serializeMember(member: TeamManagementRow['members'][number]) {
  return {
    id: member.id,
    userId: member.userId,
    firstName: member.user.firstName,
    lastName: member.user.lastName,
    role: member.user.role,
    teamRole: member.teamRole,
    status: member.status,
    assignmentDate: member.assignmentDate.toISOString(),
  };
}

function buildWidgets(teams: MobileTeamManagementItem[]) {
  return {
    total: teams.length,
    active: teams.filter((team) => team.status === TeamStatus.ACTIVE).length,
    inactive: teams.filter((team) => team.status === TeamStatus.INACTIVE).length,
    members: teams.reduce((total, team) => total + team.activeMembersCount, 0),
  };
}

function emptyManagement(canMutate: boolean): MobileTeamsManagementResponse {
  return {
    generatedAt: new Date().toISOString(),
    canMutate,
    widgets: {
      total: 0,
      active: 0,
      inactive: 0,
      members: 0,
    },
    projects: [],
    sites: [],
    teams: [],
  };
}

function normalizeStatus(status: MobileTeamStatusFilter | null) {
  if (!status || status === 'ALL') {
    return null;
  }

  return status;
}
