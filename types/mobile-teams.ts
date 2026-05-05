import type { Role, TeamMemberStatus, TeamRole, TeamStatus } from '@prisma/client';
import type { TeamDetail, UnassignedUserItem } from '@/types/teams';

export type MobileTeamStatusFilter = 'ALL' | TeamStatus;

export type MobileTeamProjectOption = {
  id: string;
  name: string;
};

export type MobileTeamSiteOption = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
};

export type MobileTeamUserOption = {
  id: string;
  firstName: string;
  lastName: string;
  role: Role;
};

export type MobileTeamMember = {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  role: Role;
  teamRole: TeamRole;
  status: TeamMemberStatus;
  assignmentDate: string;
};

export type MobileTeamManagementItem = {
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
  membersCount: number;
  membersPreview: MobileTeamMember[];
};

export type MobileTeamsManagementResponse = {
  generatedAt: string;
  canMutate: boolean;
  widgets: {
    total: number;
    active: number;
    inactive: number;
    members: number;
  };
  projects: MobileTeamProjectOption[];
  sites: MobileTeamSiteOption[];
  teams: MobileTeamManagementItem[];
};

export type MobileTeamDetailResponse = {
  generatedAt: string;
  canMutate: boolean;
  team: MobileTeamManagementItem;
  members: MobileTeamMember[];
  availableMembers: UnassignedUserItem[];
};

export type MobileTeamFormOptionsResponse = {
  projects: MobileTeamProjectOption[];
  sites: MobileTeamSiteOption[];
  teamLeads: MobileTeamUserOption[];
};

export type MobileTeamFormResponse = {
  team: TeamDetail;
  options: MobileTeamFormOptionsResponse;
};

export type MobileTeamFormPayload = {
  siteId: string;
  name: string;
  teamLeadId: string;
  status: TeamStatus;
};
