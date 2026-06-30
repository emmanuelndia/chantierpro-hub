import {
  Prisma,
  Role,
  TeamMemberStatus,
  TeamRole,
  TeamStatus,
  type PrismaClient,
} from '@prisma/client';
import { EXTERNAL_TEAM_RESOURCE_ROLES } from '@/lib/field-roles';
import type {
  AddTeamMemberInput,
  CreateTeamAssignmentInput,
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

export const teamAssignmentPublicSelect = {
  id: true,
  teamId: true,
  siteId: true,
  supervisorId: true,
  startDate: true,
  endDate: true,
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
  supervisor: {
    select: {
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.TeamAssignmentSelect;
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
      user: {
        isActive: true,
      },
    },
    orderBy: [{ assignmentDate: 'asc' }, { id: 'asc' }],
    select: teamMemberPublicSelect,
  },
  assignments: {
    orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
    select: teamAssignmentPublicSelect,
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

type SerializableTeamAssignment = Prisma.TeamAssignmentGetPayload<{
  select: typeof teamAssignmentPublicSelect;
}>;

type SerializableUnassignedUser = Prisma.UserGetPayload<{
  select: typeof unassignedUserSelect;
}>;

type UpsertActiveTeamMemberResult =
  | {
      status: 'active_exists';
      member: SerializableTeamMember;
    }
  | {
      status: 'created' | 'reactivated' | 'updated';
      member: SerializableTeamMember;
    };

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

export function isExternalTeamResourceRole(role: Role) {
  return EXTERNAL_TEAM_RESOURCE_ROLES.includes(role);
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
  if (!isRecord(body)) {
    return null;
  }

  const input: UpdateTeamInput = {};

  if ('name' in body) {
    const name = sanitizeName(body.name);
    if (!name) return null;
    input.name = name;
  }

  if ('teamLeadId' in body) {
    const teamLeadId = sanitizeString(body.teamLeadId);
    if (!teamLeadId) return null;
    input.teamLeadId = teamLeadId;
  }

  if ('status' in body) {
    const status = parseTeamStatus(body.status);
    if (!status) return null;
    input.status = status;
  }

  return Object.keys(input).length > 0 ? input : null;
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


export function parseCreateTeamAssignmentInput(body: unknown): CreateTeamAssignmentInput | null {
  if (!isRecord(body)) {
    return null;
  }

  const siteId = sanitizeString(body.siteId);
  const supervisorId = sanitizeString(body.supervisorId);
  const startDate = sanitizeDateString(body.startDate);

  if (!siteId || !supervisorId || !startDate) {
    return null;
  }

  return {
    siteId,
    supervisorId,
    startDate,
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

  return Boolean(user && user.isActive && isExternalTeamResourceRole(user.role));
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

export async function upsertActiveTeamMember(
  tx: Prisma.TransactionClient,
  payload: {
    teamId: string;
    userId: string;
    teamRole: TeamRole;
    createdById: string;
    assignmentDate?: Date;
    activeMode?: 'conflict' | 'updateRole';
  },
): Promise<UpsertActiveTeamMemberResult> {
  const assignmentDate = payload.assignmentDate ?? toDateOnlyDate(new Date());
  const activeMember = await tx.teamMember.findFirst({
    where: {
      teamId: payload.teamId,
      userId: payload.userId,
      status: TeamMemberStatus.ACTIVE,
    },
    select: teamMemberPublicSelect,
  });

  if (activeMember) {
    if (payload.activeMode === 'updateRole' && activeMember.teamRole !== payload.teamRole) {
      const updated = await tx.teamMember.update({
        where: { id: activeMember.id },
        data: { teamRole: payload.teamRole },
        select: teamMemberPublicSelect,
      });

      return { status: 'updated', member: updated };
    }

    return { status: 'active_exists', member: activeMember };
  }

  const inactiveMember = await tx.teamMember.findFirst({
    where: {
      teamId: payload.teamId,
      userId: payload.userId,
      status: TeamMemberStatus.INACTIVE,
    },
    orderBy: [{ endDate: 'desc' }, { assignmentDate: 'desc' }, { id: 'desc' }],
    select: { id: true },
  });

  if (inactiveMember) {
    const reactivated = await tx.teamMember.update({
      where: { id: inactiveMember.id },
      data: {
        status: TeamMemberStatus.ACTIVE,
        endDate: null,
        assignmentDate,
        teamRole: payload.teamRole,
      },
      select: teamMemberPublicSelect,
    });

    return { status: 'reactivated', member: reactivated };
  }

  const created = await tx.teamMember.create({
    data: {
      teamId: payload.teamId,
      userId: payload.userId,
      teamRole: payload.teamRole,
      assignmentDate,
      status: TeamMemberStatus.ACTIVE,
      createdById: payload.createdById,
    },
    select: teamMemberPublicSelect,
  });

  return { status: 'created', member: created };
}

export async function syncTeamLeadMembership(
  tx: Prisma.TransactionClient,
  payload: {
    teamId: string;
    teamLeadId: string;
    createdById: string;
    effectiveDate?: Date;
  },
) {
  const effectiveDate = toDateOnlyDate(payload.effectiveDate ?? new Date());

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
      endDate: effectiveDate,
    },
  });

  await upsertActiveTeamMember(tx, {
    teamId: payload.teamId,
    userId: payload.teamLeadId,
    teamRole: TeamRole.TEAM_LEAD,
    assignmentDate: effectiveDate,
    createdById: payload.createdById,
    activeMode: 'updateRole',
  });
}

export async function createInitialTeamAssignment(
  tx: Prisma.TransactionClient,
  payload: {
    teamId: string;
    siteId: string;
    supervisorId: string;
    createdById: string;
    startDate?: Date;
  },
) {
  return tx.teamAssignment.create({
    data: {
      teamId: payload.teamId,
      siteId: payload.siteId,
      supervisorId: payload.supervisorId,
      startDate: payload.startDate ?? toDateOnlyDate(new Date()),
      createdById: payload.createdById,
    },
    select: teamAssignmentPublicSelect,
  });
}

export async function reassignTeam(
  tx: Prisma.TransactionClient,
  payload: {
    teamId: string;
    siteId: string;
    supervisorId: string;
    startDate: Date;
    createdById: string;
  },
) {
  const startDate = toDateOnlyDate(payload.startDate);
  const previousDay = addDays(startDate, -1);
  const overlapping = await tx.teamAssignment.findFirst({
    where: {
      teamId: payload.teamId,
      startDate: { lte: startDate },
      OR: [{ endDate: null }, { endDate: { gte: startDate } }],
    },
    orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
    select: { id: true, startDate: true, siteId: true, supervisorId: true },
  });

  if (overlapping && overlapping.startDate.getTime() === startDate.getTime()) {
    const updated = await tx.teamAssignment.update({
      where: { id: overlapping.id },
      data: {
        siteId: payload.siteId,
        supervisorId: payload.supervisorId,
      },
      select: teamAssignmentPublicSelect,
    });

    await tx.team.update({
      where: { id: payload.teamId },
      data: {
        siteId: payload.siteId,
        teamLeadId: payload.supervisorId,
      },
    });

    await syncTeamLeadMembership(tx, {
      teamId: payload.teamId,
      teamLeadId: payload.supervisorId,
      createdById: payload.createdById,
      effectiveDate: startDate,
    });

    return updated;
  }

  if (overlapping) {
    await tx.teamAssignment.update({
      where: { id: overlapping.id },
      data: { endDate: previousDay },
    });
  }

  const futureOverlap = await tx.teamAssignment.findFirst({
    where: {
      teamId: payload.teamId,
      startDate: { gt: startDate },
      OR: [{ endDate: null }, { endDate: { gte: startDate } }],
    },
    select: { id: true },
  });

  if (futureOverlap) {
    throw new TeamAssignmentConflictError();
  }

  const created = await tx.teamAssignment.create({
    data: {
      teamId: payload.teamId,
      siteId: payload.siteId,
      supervisorId: payload.supervisorId,
      startDate,
      createdById: payload.createdById,
    },
    select: teamAssignmentPublicSelect,
  });

  await tx.team.update({
    where: { id: payload.teamId },
    data: {
      siteId: payload.siteId,
      teamLeadId: payload.supervisorId,
    },
  });

  await syncTeamLeadMembership(tx, {
    teamId: payload.teamId,
    teamLeadId: payload.supervisorId,
    createdById: payload.createdById,
    effectiveDate: startDate,
  });

  return created;
}

export class TeamAssignmentConflictError extends Error {
  constructor() {
    super('TEAM_ASSIGNMENT_CONFLICT');
  }
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


export function serializeTeamAssignment(assignment: SerializableTeamAssignment) {
  return {
    id: assignment.id,
    teamId: assignment.teamId,
    siteId: assignment.siteId,
    siteName: assignment.site.name,
    projectId: assignment.site.projectId,
    projectName: assignment.site.project.name,
    supervisorId: assignment.supervisorId,
    supervisorName: `${assignment.supervisor.firstName} ${assignment.supervisor.lastName}`,
    startDate: assignment.startDate.toISOString(),
    endDate: assignment.endDate?.toISOString() ?? null,
    isCurrent: assignment.endDate === null,
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
    currentAssignment: team.assignments.find((assignment) => assignment.endDate === null) ? serializeTeamAssignment(team.assignments.find((assignment) => assignment.endDate === null)!) : null,
    assignmentHistory: team.assignments.map(serializeTeamAssignment),
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
  _siteId: string,
): Promise<UnassignedUserItem[]> {
  const users = await prisma.user.findMany({
    where: {
      role: {
        in: [...EXTERNAL_TEAM_RESOURCE_ROLES],
      },
      isActive: true,
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
    select: unassignedUserSelect,
  });

  return users.map(serializeUnassignedUser);
}

function sanitizeDateString(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return null;
  }

  return value.trim();
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

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnlyDate(date);
}
