import type { ClockInStatus, ClockInType, Role } from '@prisma/client';

export type ClockInRecordItem = {
  id: string;
  siteId: string;
  siteName: string;
  userId: string;
  type: ClockInType;
  clockInDate: string;
  clockInTime: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  distanceToSite: number;
  status: ClockInStatus;
  comment: string | null;
  timestampLocal: string;
  createdAt: string;
};

export type ActiveClockInSession = {
  siteId: string;
  siteName: string;
  arrivalAt: string;
  durationSeconds: number;
};

export type TodayClockInView = {
  date: string;
  activeSession: ActiveClockInSession | null;
  items: ClockInRecordItem[];
};

export type ClockInHistoryItem = ClockInRecordItem;

export type SessionStatus = {
  sessionOpen: boolean;
  arrivalTime: string | null;
  duration: number | null;
  pauseActive: boolean;
  pauseDuration: number;
};

export type AttendancePersonItem = {
  userId: string;
  firstName: string;
  lastName: string;
  role: Role;
};

export type AttendanceToday = {
  date: string;
  presentNow: AttendancePersonItem[];
  departedToday: AttendancePersonItem[];
  absent: AttendancePersonItem[];
};

export type ClockInInput = {
  type: ClockInType;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  timestampLocal: string;
  comment?: string | null;
};

export type BatchSyncItemInput = ClockInInput & {
  siteId: string;
};

export type BatchSyncItemResult = {
  siteId: string;
  type: ClockInType;
  timestampLocal: string;
  accepted: boolean;
  status: ClockInStatus;
  errorCode?: ClockInApiErrorCode;
  message?: string;
  recordId?: string;
};

export type ClockInApiErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'OUTSIDE_RADIUS'
  | 'GPS_SPOOFING_SUSPECTED'
  | 'SESSION_ALREADY_OPEN'
  | 'DEPARTURE_BEFORE_ARRIVAL'
  | 'NO_OPEN_SESSION'
  | 'PAUSE_ALREADY_ACTIVE'
  | 'PAUSE_END_BEFORE_PAUSE_START'
  | 'NO_ACTIVE_PAUSE'
  | 'SITE_INACTIVE'
  | 'PERMISSION_DENIED';
