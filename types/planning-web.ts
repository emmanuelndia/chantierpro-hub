import type {
  CreateAssignmentRequest,
  DuplicateAssignmentsRequest,
  DuplicateAssignmentsResponse,
  PlanningAssignment,
  PlanningAssignmentMutationResponse,
  PlanningDayResponse,
  UpdateAssignmentRequest,
} from '@/types/mobile-planning';

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
