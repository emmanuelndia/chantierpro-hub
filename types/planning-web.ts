import type {
  CreateAssignmentRequest,
  DuplicateAssignmentsRequest,
  DuplicateAssignmentsResponse,
  PlanningAssignment,
  PlanningAssignmentMutationResponse,
  PlanningDayResponse,
  PlanningObjectiveStatus,
  TaskProgressUpdateItem,
  UpdateAssignmentRequest,
} from '@/types/mobile-planning';
import type { PlanningAssignmentStatus, PlanningWorkLocationType, Role, SiteType } from '@prisma/client';

export type PlanningWebAssignment = PlanningAssignment;
export type PlanningWebDayResponse = PlanningDayResponse;
export type PlanningWebCreateRequest = CreateAssignmentRequest;
export type PlanningWebUpdateRequest = UpdateAssignmentRequest;
export type PlanningWebDuplicateRequest = DuplicateAssignmentsRequest;
export type PlanningWebMutationResponse = PlanningAssignmentMutationResponse;
export type PlanningWebDuplicateResponse = DuplicateAssignmentsResponse;

export type PlanningWebFilters = {
  projectId: string;
  siteId: string;
  resourceId: string;
};

export type CentralizedPlanningAssignment = {
  id: string;
  date: string;
  projectId: string;
  projectName: string;
  projectManagerId: string;
  projectManagerName: string;
  siteId: string;
  siteName: string;
  siteAddress: string;
  siteType: SiteType | 'FREE_MISSION';
  resourceId: string;
  resourceName: string;
  resourceRole: Role;
  action: string;
  plannedZone?: string | null;
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
  createdBy: {
    id: string;
    name: string;
    role: Role;
  };
  canEdit: boolean;
};

export type CentralizedPlanningResponse = {
  generatedAt: string;
  from: string;
  to: string;
  items: CentralizedPlanningAssignment[];
};

export type CentralizedPlanningFilters = {
  from: string;
  to: string;
  projectId: string;
  siteId: string;
  resourceId: string;
  role: string;
  workLocationType: string;
  projectManagerId: string;
};
