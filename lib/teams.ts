import {
  Prisma,
  Role,
  TeamMemberStatus,
  TeamRole,
  TeamStatus,
  type PrismaClient,
} from '@prisma/client';
import type {
  AddTeamMemberInput,
  CreateTeamInput,
  TeamApiErrorCode,
  TeamDetail,
  TeamMemberItem,
  UnassignedUserItem,
  UpdateTeamInput,
} from '@/types/teams';

const TEAM_MANAGE_ROLES: readonly Role[] = [
  Role.GENERAL_SUPERVISOR,
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
  Role.ADMIN,
];
const FIELD_MEMBER_ROLES: readonly Role[] = [
  Role.SUPERVISOR,
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
];

export const teamMemberPublicSelect = {
  id: true,
  userId: true,
  teamRole: true,
  assignmentDate: true,
  status: true,
  user: {
    select: {
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.TeamMemberSelect;

export const teamPublicSelect = {
  id: true,
  name: true,
  siteId: true,
  teamLeadId: true,
  status: true,
  createdById: true,
  createdAt: true,
  members: {
    where: {
      status: TeamMemberStatus.ACTIVE,
    },
    orderBy: [{ assignmentDate: 'asc' }, { id: 'asc' }],
    select: teamMemberPublicSelect,
  },
} satisfies Prisma.TeamSelect;

const unassignedUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  contact: true,
} satisfies Prisma.UserSelect;

type SerializableTeam = Prisma.TeamGetPayload<{
  select: typeof teamPublicSelect;
}>;

type SerializableTeamMember = Prisma.TeamMemberGetPayload<{
  select: typeof teamMemberPublicSelect;
}>;

type SerializableUnassignedUser = Prisma.UserGetPayload<{
  select: typeof unassignedUserSelect;
}>;

type AuthLikeUser = {
  id: string;
  role: Role;
};

export function jsonTeamError(
  code: TeamApiErrorCode,
  status: number,
  message: string,
  extra?: Record<string, boolean | number | string>,
) {
  return Response.json(
    {
      code,
      message,
      ...extra,
    },
    { status },
  );
}

export function canManageTeams(role: Role) {
  return TEAM_MANAGE_ROLES.includes(role);
}

export function teamAccessWhere(user: AuthLikeUser): Prisma.TeamWhereInput {
  if (user.role === Role.PROJECT_MANAGER) {
    return {
      site: {
        project: {
          projectManagerId: user.id,
        },
      },
    };
  }

  return {};
}

export function siteAccessWhere(user: AuthLikeUser): Prisma.SiteWhereInput {
  if (user.role === Role.PROJECT_MANAGER) {
    return {
      project: {
        projectManagerId: user.id,
      },
    };
  }

  return {};
}

export async function getScopedSiteByIdForTeams(
  prisma: PrismaClient,
  siteId: string,
  user: AuthLikeUser,
) {
  return prisma.site.findFirst({
    where: {
      id: siteId,
      ...siteAccessWhere(user),
    },
    select: {
      id: true,
      projectId: true,
      name: true,
    },
  });
}

export async function getScopedTeamById(
  prisma: PrismaClient,
  teamId: string,
  user: AuthLikeUser,
) {
  return prisma.team.findFirst({
    where: {
      id: teamId,
      ...teamAccessWhere(user),
    },
    select: teamPublicSelect,
  });
}

export async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function parseCreateTeamInput(body: unknown): CreateTeamInput | null {
  if (!isRecord(body)) {
    return null;
  }

  const name = sanitizeName(body.name);
  const teamLeadId = sanitizeString(body.teamLeadId);
  const status = parseTeamStatus(body.status) ?? TeamStatus.ACTIVE;

  if (!name || !teamLeadId || !status) {
    return null;
  }

  return {
    name,
    teamLeadId,
    status,
  };
}

export function parseUpdateTeamInput(body: unknown): UpdateTeamInput | null {
  return parseCreateTeamInput(body);
}

export function parseAddTeamMemberInput(body: unknown): AddTeamMemberInput | null {
  if (!isRecord(body)) {
    return null;
  }

  const userId = sanitizeString(body.userId);
  const teamRole = parseTeamRole(body.teamRole);

  if (!userId || !teamRole) {
    return null;
  }

  return {
    userId,
    teamRole,
  };
}

export async function validateActiveTechnician(prisma: PrismaClient, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      isActive: true,
    },
  });

  return Boolean(user && user.isActive && FIELD_MEMBER_ROLES.includes(user.role));
}

export async function hasActiveMember(prisma: PrismaClient, teamId: string, userId: string) {
  const existing = await prisma.teamMember.findFirst({
    where: {
      teamId,
      userId,
      status: TeamMemberStatus.ACTIVE,
    },
    select: {
      id: true,
    },
  });

  return Boolean(existing);
}

export async function syncTeamLeadMembership(
  tx: Prisma.TransactionClient,
  payload: {
    teamId: string;
    teamLeadId: string;
    createdById: string;
  },
) {
  const today = toDateOnlyDate(new Date());

  await tx.teamMember.updateMany({
    where: {
      teamId: payload.teamId,
      teamRole: TeamRole.TEAM_LEAD,
      status: TeamMemberStatus.ACTIVE,
      userId: {
        not: payload.teamLeadId,
      },
    },
    data: {
      status: TeamMemberStatus.INACTIVE,
      endDate: today,
    },
  });

  const activeMembership = await tx.teamMember.findFirst({
    where: {
      teamId: payload.teamId,
      userId: payload.teamLeadId,
      status: TeamMemberStatus.ACTIVE,
    },
    select: {
      id: true,
    },
  });

  if (activeMembership) {
    await tx.teamMember.update({
      where: {
        id: activeMembership.id,
      },
      data: {
        teamRole: TeamRole.TEAM_LEAD,
      },
    });
    return;
  }

  await tx.teamMember.create({
    data: {
      teamId: payload.teamId,
      userId: payload.teamLeadId,
      teamRole: TeamRole.TEAM_LEAD,
      assignmentDate: today,
      status: TeamMemberStatus.ACTIVE,
      createdById: payload.createdById,
    },
  });
}

export async function softDeleteTeamMember(
  tx: Prisma.TransactionClient,
  payload: {
    teamId: string;
    userId: string;
  },
) {
  const activeMember = await tx.teamMember.findFirst({
    where: {
      teamId: payload.teamId,
      userId: payload.userId,
      status: TeamMemberStatus.ACTIVE,
    },
    select: {
      id: true,
    },
  });

  if (!activeMember) {
    return null;
  }

  return tx.teamMember.update({
    where: {
      id: activeMember.id,
    },
    data: {
      status: TeamMemberStatus.INACTIVE,
      endDate: toDateOnlyDate(new Date()),
    },
  });
}

export function serializeTeamMember(member: SerializableTeamMember): TeamMemberItem {
  return {
    id: member.id,
    userId: member.userId,
    firstName: member.user.firstName,
    lastName: member.user.lastName,
    teamRole: member.teamRole,
    assignmentDate: member.assignmentDate.toISOString(),
    status: member.status,
  };
}

export function serializeTeam(team: SerializableTeam): TeamDetail {
  return {
    id: team.id,
    name: team.name,
    siteId: team.siteId,
    teamLeadId: team.teamLeadId,
    status: team.status,
    createdById: team.createdById,
    createdAt: team.createdAt.toISOString(),
    members: team.members.map(serializeTeamMember),
  };
}

export function serializeUnassignedUser(user: SerializableUnassignedUser): UnassignedUserItem {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    contact: user.contact,
  };
}

export async function listUnassignedTechnicians(
  prisma: PrismaClient,
  siteId: string,
): Promise<UnassignedUserItem[]> {
  const users = await prisma.user.findMany({
    where: {
      role: {
        in: [...FIELD_MEMBER_ROLES],
      },
      isActive: true,
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
    select: unassignedUserSelect,
  });

  return users.map(serializeUnassignedUser);
}

function sanitizeName(value: unknown) {
  const name = sanitizeString(value);

  if (!name || name.length < 3 || name.length > 100) {
    return null;
  }

  return name;
}

function sanitizeString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseTeamStatus(value: unknown) {
  return typeof value === 'string' && Object.values(TeamStatus).includes(value as TeamStatus)
    ? (value as TeamStatus)
    : null;
}

function parseTeamRole(value: unknown) {
  return typeof value === 'string' && Object.values(TeamRole).includes(value as TeamRole)
    ? (value as TeamRole)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toDateOnlyDate(value: Date) {
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}
