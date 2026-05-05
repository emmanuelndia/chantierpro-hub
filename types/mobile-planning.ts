import type { PlanningAssignmentStatus, SiteStatus } from '@prisma/client';

export type PlanningClockInStatus = 'CLOCKED_IN' | 'CLOCKED_OUT' | 'ON_PAUSE';

export type PlanningAssignment = {
  id: string;
  supervisorId: string;
  supervisorName: string;
  supervisorFirstName: string;
  siteId: string;
  siteName: string;
  siteAddress: string;
  action: string;
  targetProgress: number | null;
  assignedAt: string;
  status: PlanningAssignmentStatus;
  clockInStatus: PlanningClockInStatus;
};

export type UnassignedSupervisor = {
  id: string;
  name: string;
  firstName: string;
  email: string;
  contact: string;
  isActive: boolean;
};

export type AvailableSite = {
  id: string;
  name: string;
  address: string;
  status: SiteStatus;
  project: {
    id: string;
    name: string;
  };
};

export type PlanningDayResponse = {
  date: string;
  assignments: PlanningAssignment[];
  unassignedSupervisors: UnassignedSupervisor[];
  availableSites: AvailableSite[];
  hasAssignments: boolean;
  canDuplicateFromYesterday: boolean;
};

export type CreateAssignmentRequest = {
  supervisorId: string;
  siteId: string;
  action: string;
  targetProgress: number | null;
  date: string;
};

export type UpdateAssignmentRequest = {
  action?: string;
  targetProgress?: number | null;
  status?: PlanningAssignmentStatus;
};

export type DuplicateAssignmentsRequest = {
  sourceDate: string;
  targetDate: string;
};

export type PlanningAssignmentMutationResponse = {
  assignment: PlanningAssignment;
};

export type DuplicateAssignmentsResponse = {
  createdCount: number;
  skippedCount: number;
  assignments: PlanningAssignment[];
};
