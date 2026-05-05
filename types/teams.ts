import type { TeamMemberStatus, TeamRole, TeamStatus } from '@prisma/client';

export type TeamMemberItem = {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  teamRole: TeamRole;
  assignmentDate: string;
  status: TeamMemberStatus;
};

export type TeamDetail = {
  id: string;
  name: string;
  siteId: string;
  teamLeadId: string;
  status: TeamStatus;
  createdById: string;
  createdAt: string;
  members: TeamMemberItem[];
};

export type UnassignedUserItem = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  contact: string;
};

export type CreateTeamInput = {
  name: string;
  teamLeadId: string;
  status: TeamStatus;
};

export type UpdateTeamInput = CreateTeamInput;

export type AddTeamMemberInput = {
  userId: string;
  teamRole: TeamRole;
};

export type TeamApiErrorCode =
  | 'BAD_REQUEST'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_TEAM_LEAD'
  | 'INVALID_MEMBER'
  | 'TEAM_LEAD_REMOVAL_FORBIDDEN';
