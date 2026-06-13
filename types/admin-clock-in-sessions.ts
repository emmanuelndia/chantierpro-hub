import type { Role } from '@prisma/client';

export type AdminClockInSessionContext = 'SITE' | 'FREE_MISSION' | 'OFFICE';

export type AdminClockInSessionStatus =
  | 'OPEN'
  | 'FORGOTTEN_EXIT'
  | 'CLOSED'
  | 'CLOSED_BY_ADMIN'
  | 'REMOTE_CHECKOUT'
  | 'ANOMALY';

export type AdminClockInSessionRecord = {
  id: string;
  type: string;
  recordedAt: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  isRemoteCheckout: boolean;
  isRegularized: boolean;
  isAutoClosed: boolean;
  comment: string | null;
};

export type AdminClockInSessionItem = {
  sessionId: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    matricule: string | null;
    role: Role;
  };
  context: AdminClockInSessionContext;
  contextLabel: string;
  projectName: string | null;
  taskAction: string | null;
  arrivalRecord: AdminClockInSessionRecord;
  departureRecord: AdminClockInSessionRecord | null;
  timeline: AdminClockInSessionRecord[];
  status: AdminClockInSessionStatus;
  durationSeconds: number | null;
  isStale: boolean;
  isRemoteCheckout: boolean;
  isClosedByAdmin: boolean;
  canClose: boolean;
};

export type AdminClockInSessionsResponse = {
  generatedAt: string;
  items: AdminClockInSessionItem[];
  summary: {
    total: number;
    open: number;
    forgotten: number;
    closed: number;
    remote: number;
    anomalies: number;
  };
};
