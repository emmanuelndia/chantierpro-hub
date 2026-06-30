import type { Role, TeamMemberStatus, TeamRole, TeamStatus } from '@prisma/client';
import type { TeamAssignmentItem, UnassignedUserItem } from '@/types/teams';

export type WebTeamStatusFilter = 'ALL' | TeamStatus;

export type WebTeamProjectOption = {
  id: string;
  name: string;
};

export type WebTeamSiteOption = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
};

export type WebTeamUserOption = {
  id: string;
  firstName: string;
  lastName: string;
  role: Role;
};

export type WebTeamMember = {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  role: Role;
  teamRole: TeamRole;
  status: TeamMemberStatus;
  assignmentDate: string;
  endDate: string | null;
};

export type WebTeamItem = {
  id: string;
  name: string;
  status: TeamStatus;
  siteId: string;
  siteName: string;
  projectId: string;
  projectName: string;
  teamLeadId: string;
  teamLeadName: string;
  activeMembersCount: number;
  inactiveMembersCount: number;
  currentAssignment: TeamAssignmentItem | null;
  assignmentHistory: TeamAssignmentItem[];
};

export type WebTeamsResponse = {
  generatedAt: string;
  widgets: {
    total: number;
    active: number;
    inactive: number;
    members: number;
  };
  projects: WebTeamProjectOption[];
  sites: WebTeamSiteOption[];
  teams: WebTeamItem[];
};

export type WebTeamDetailResponse = {
  generatedAt: string;
  team: WebTeamItem;
  activeMembers: WebTeamMember[];
  inactiveMembers: WebTeamMember[];
  availableMembers: UnassignedUserItem[];
};

export type WebTeamFormOptionsResponse = {
  projects: WebTeamProjectOption[];
  sites: WebTeamSiteOption[];
  teamLeads: WebTeamUserOption[];
};

export type WebTeamPayload = {
  siteId: string;
  name: string;
  teamLeadId: string;
  status: TeamStatus;
};

export type WebTeamMemberPayload = {
  userId: string;
  teamRole: TeamRole;
};
