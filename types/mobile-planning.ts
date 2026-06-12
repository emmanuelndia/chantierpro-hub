import type { PlanningAssignmentStatus, PlanningWorkLocationType, SiteStatus, SiteType } from '@prisma/client';

export type PlanningClockInStatus = 'CLOCKED_IN' | 'CLOCKED_OUT' | 'ON_PAUSE';
export type PlanningObjectiveStatus = 'NOT_STARTED' | 'PARTIAL' | 'ACHIEVED' | 'BLOCKED';

export type TaskProgressUpdateItem = {
  id: string;
  progress: number | null;
  actualQuantity: number | null;
  comment: string | null;
  blocked: boolean;
  completed: boolean;
  createdAt: string;
  createdBy: {
    id: string;
    firstName: string;
    lastName: string;
  };
};

export type PlanningAssignment = {
  id: string;
  kind?: 'PLANNING_ASSIGNMENT' | 'FREE_MISSION';
  supervisorId: string;
  supervisorName: string;
  supervisorFirstName: string;
  siteId: string | null;
  freeMissionId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  siteName: string;
  siteAddress: string;
  siteType: SiteType | 'FREE_MISSION';
  action: string;
  targetProgress: number | null;
  targetQuantity: number | null;
  targetUnit: string | null;
  objectiveText: string | null;
  plannedDurationMinutes: number | null;
  actualProgress: number | null;
  actualQuantity: number | null;
  progressDelta: number | null;
  remainingQuantity: number | null;
  objectiveStatus: PlanningObjectiveStatus;
  latestProgressUpdate: TaskProgressUpdateItem | null;
  assignedAt: string;
  status: PlanningAssignmentStatus;
  workLocationType: PlanningWorkLocationType;
  clockInStatus: PlanningClockInStatus;
  createdBy: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
  };
};

export type PlanningClockInStatusItem = {
  supervisorId: string;
  siteId: string;
  status: PlanningClockInStatus;
  lastEventAt: string | null;
};

export type UnassignedSupervisor = {
  id: string;
  name: string;
  firstName: string;
  email: string | null;
  contact: string;
  isActive: boolean;
  availabilityLabel: string;
  assignedSiteName: string | null;
};

export type AvailableSite = {
  id: string;
  name: string;
  address: string;
  siteType: SiteType;
  requiresClockIn: boolean;
  status: SiteStatus;
  project: {
    id: string;
    name: string;
  };
};

export type AvailableProject = {
  id: string;
  name: string;
};

export type PlanningDayResponse = {
  date: string;
  assignments: PlanningAssignment[];
  clockInStatuses: PlanningClockInStatusItem[];
  unassignedSupervisors: UnassignedSupervisor[];
  availableProjects: AvailableProject[];
  availableSites: AvailableSite[];
  hasAssignments: boolean;
  canDuplicateFromYesterday: boolean;
};

export type CreateAssignmentRequest = {
  supervisorId?: string;
  supervisorIds?: string[];
  siteId: string;
  action: string;
  targetProgress?: number | null;
  targetQuantity?: number | null;
  targetUnit?: string | null;
  date: string;
  workLocationType: PlanningWorkLocationType;
  objectiveText?: string | null;
  plannedDurationMinutes?: number | null;
};

export type UpdateAssignmentRequest = {
  action?: string;
  targetProgress?: number | null;
  targetQuantity?: number | null;
  targetUnit?: string | null;
  status?: PlanningAssignmentStatus;
  workLocationType?: PlanningWorkLocationType;
  objectiveText?: string | null;
  plannedDurationMinutes?: number | null;
};

export type DuplicateAssignmentsRequest = {
  sourceDate: string;
  targetDate: string;
};

export type PlanningAssignmentMutationResponse = {
  assignment?: PlanningAssignment;
  assignments?: PlanningAssignment[];
  createdCount?: number;
  skippedCount?: number;
};

export type DuplicateAssignmentsResponse = {
  createdCount: number;
  skippedCount: number;
  assignments: PlanningAssignment[];
};

export type SupervisorTaskPhoto = {
  id: string;
  filename: string;
  takenAt: string;
  url: string;
};

export type SupervisorMyAssignment = {
  id: string;
  kind?: 'PLANNING_ASSIGNMENT' | 'FREE_MISSION';
  date: string;
  siteId: string | null;
  freeMissionId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  siteName: string;
  siteAddress: string;
  siteType: SiteType | 'FREE_MISSION';
  action: string;
  targetProgress: number | null;
  targetQuantity: number | null;
  targetUnit: string | null;
  objectiveText: string | null;
  plannedDurationMinutes: number | null;
  actualProgress: number | null;
  actualQuantity: number | null;
  progressDelta: number | null;
  remainingQuantity: number | null;
  objectiveStatus: PlanningObjectiveStatus;
  latestProgressUpdate: TaskProgressUpdateItem | null;
  status: PlanningAssignmentStatus;
  workLocationType: PlanningWorkLocationType;
  photos: SupervisorTaskPhoto[];
};

export type SupervisorMyAssignmentsResponse = {
  date: string;
  assignments: SupervisorMyAssignment[];
};

export type CreateTaskProgressUpdateRequest = {
  progress?: number | null;
  actualQuantity?: number | null;
  comment?: string | null;
  blocked?: boolean;
  completed?: boolean;
};

export type TaskProgressUpdateResponse = {
  update: TaskProgressUpdateItem;
  assignment: SupervisorMyAssignment;
};
