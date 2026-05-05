import type { ClockInType } from '@prisma/client';

export type TeamPresenceStatusFilter = 'all' | 'present' | 'paused' | 'departed' | 'absent';

export type TeamPresenceSiteOption = {
  id: string;
  name: string;
};

export type TeamPresenceTimelineItem = {
  id: string;
  type: ClockInType;
  timestampLocal: string;
  siteId: string;
  siteName: string;
  comment: string | null;
};

export type TeamPresenceReportState = {
  submitted: boolean;
  reportId: string | null;
  submittedAt: string | null;
};

export type TeamPresenceItem = {
  id: string;
  supervisorId: string;
  supervisorName: string;
  siteId: string;
  siteName: string;
  arrivalAt: string | null;
  departureAt: string | null;
  durationSeconds: number | null;
  effectiveDurationSeconds: number | null;
  currentPauseSeconds: number | null;
  timeline: TeamPresenceTimelineItem[];
  report: TeamPresenceReportState;
};

export type TeamPresencesResponse = {
  date: string;
  generatedAt: string;
  sites: TeamPresenceSiteOption[];
  presentNow: TeamPresenceItem[];
  onPause: TeamPresenceItem[];
  departedToday: TeamPresenceItem[];
  absent: TeamPresenceItem[];
};

export type TeamPresencesApiErrorCode = 'BAD_REQUEST' | 'FORBIDDEN';
