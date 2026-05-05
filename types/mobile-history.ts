import type { ClockInStatus, ClockInType } from '@prisma/client';

export type MobileHistoryPeriod = 'week' | 'month';

export type MobileHistorySessionStatus =
  | 'COMPLETE'
  | 'PAUSE_ACTIVE'
  | 'IN_PROGRESS'
  | 'INCOMPLETE';

export type MobileHistorySummary = {
  realDurationSeconds: number;
  sessionsCount: number;
  photosCount: number;
};

export type MobileHistoryRecord = {
  id: string;
  type: ClockInType;
  status: ClockInStatus;
  timestampLocal: string;
  distanceToSite: number;
  comment: string | null;
};

export type MobileHistoryPhoto = {
  id: string;
  siteId: string;
  filename: string;
  timestampLocal: string;
  url: string | null;
};

export type MobileHistoryReport = {
  id: string;
  content: string;
  submittedAt: string;
};

export type MobileHistorySession = {
  id: string;
  siteId: string;
  siteName: string;
  startedAt: string;
  endedAt: string | null;
  status: MobileHistorySessionStatus;
  realDurationSeconds: number;
  pauseDurationSeconds: number;
  records: MobileHistoryRecord[];
  report: MobileHistoryReport | null;
  photos: MobileHistoryPhoto[];
};

export type MobileHistoryDay = {
  date: string;
  sessions: MobileHistorySession[];
  photos: MobileHistoryPhoto[];
};

export type MobileHistoryResponse = {
  period: MobileHistoryPeriod;
  summary: MobileHistorySummary;
  days: MobileHistoryDay[];
  nextCursor: string | null;
};
