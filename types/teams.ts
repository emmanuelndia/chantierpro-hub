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

export type TeamAssignmentItem = {
  id: string;
  teamId: string;
  siteId: string;
  siteName: string;
  projectId: string;
  projectName: string;
  supervisorId: string;
  supervisorName: string;
  startDate: string;
  endDate: string | null;
  isCurrent: boolean;
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
  currentAssignment: TeamAssignmentItem | null;
  assignmentHistory: TeamAssignmentItem[];
};

export type UnassignedUserItem = {
  id: string;
  email: string | null;
  firstName: string;
  lastName: string;
  contact: string;
};

export type CreateTeamInput = {
  name: string;
  teamLeadId: string;
  status: TeamStatus;
};

export type UpdateTeamInput = Partial<CreateTeamInput>;

export type AddTeamMemberInput = {
  userId: string;
  teamRole: TeamRole;
};

export type CreateTeamAssignmentInput = {
  siteId: string;
  supervisorId: string;
  startDate: string;
};

export type TeamApiErrorCode =
  | 'BAD_REQUEST'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_TEAM_LEAD'
  | 'INVALID_MEMBER'
  | 'TEAM_LEAD_REMOVAL_FORBIDDEN'
  | 'INVALID_ASSIGNMENT_DATE';