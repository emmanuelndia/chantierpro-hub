import type { ProjectStatus } from '@prisma/client';

export type ProjectProgressStatus = 'ON_TRACK' | 'AT_RISK' | 'LATE' | 'COMPLETED';

export type ProjectProgressItem = {
  projectId: string;
  projectName: string;
  projectManagerName: string;
  status: ProjectStatus;
  startDate: string;
  endDate: string | null;
  globalProgress: number;
  progressStatus: ProjectProgressStatus;
  alerts: string[];
  sites: {
    total: number;
    active: number;
    completed: number;
    late: number;
  };
  tasks: {
    total: number;
    achieved: number;
    partial: number;
    blocked: number;
    notStarted: number;
    late: number;
    plannedDurationMinutes: number;
  };
};

export type ProjectProgressResponse = {
  generatedAt: string;
  summary: {
    projects: number;
    lateProjects: number;
    atRiskProjects: number;
    averageProgress: number;
    blockedTasks: number;
  };
  items: ProjectProgressItem[];
};
