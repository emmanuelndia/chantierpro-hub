import type {
  PlanningAssignmentStatus,
  Role,
  TeamMemberStatus,
  TeamRole,
  TeamStatus,
} from '@prisma/client';

export type ResourceHistoryOption = {
  id: string;
  name: string;
};

export type ResourceHistorySiteOption = ResourceHistoryOption & {
  projectId: string;
  projectName: string;
};

export type ResourceAssignmentsHistoryResponse = {
  generatedAt: string;
  resource: {
    id: string;
    firstName: string;
    lastName: string;
    role: Role;
    isActive: boolean;
  };
  filters: {
    from: string | null;
    to: string | null;
    projectId: string | null;
    siteId: string | null;
  };
  widgets: {
    activeTeams: number;
    inactiveTeams: number;
    planningAssignments: number;
    todayAssignments: number;
  };
  options: {
    projects: ResourceHistoryOption[];
    sites: ResourceHistorySiteOption[];
  };
  todayAssignments: ResourceTodayAssignmentItem[];
  teamMemberships: ResourceTeamHistoryItem[];
  planningAssignments: ResourcePlanningHistoryItem[];
};

export type ResourceTodayAssignmentItem = {
  id: string;
  date: string;
  action: string;
  targetProgress: number | null;
  status: PlanningAssignmentStatus;
  deletedAt: string | null;
  site: ResourceHistoryOption;
  project: ResourceHistoryOption;
};

export type ResourceTeamHistoryItem = {
  id: string;
  teamRole: TeamRole;
  status: TeamMemberStatus;
  assignmentDate: string;
  endDate: string | null;
  team: {
    id: string;
    name: string;
    status: TeamStatus;
  };
  site: ResourceHistoryOption;
  project: ResourceHistoryOption;
};

export type ResourcePlanningHistoryItem = ResourceTodayAssignmentItem & {
  createdAt: string;
};
