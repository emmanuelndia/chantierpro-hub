import type { PlanningWorkLocationType } from '@prisma/client';

export type PlanningTaskTemplateItem = {
  id: string;
  name: string;
  action: string;
  targetProgress: number | null;
  targetQuantity: string | null;
  targetUnit: string | null;
  objectiveText: string | null;
  plannedDurationMinutes: number | null;
  workLocationType: PlanningWorkLocationType;
  createdAt: string;
};

export type PlanningTaskTemplatesResponse = {
  items: PlanningTaskTemplateItem[];
};
