import type { OfficeClockInLocation } from '@prisma/client';
import type { ClockInRecordItem, SessionStatus } from '@/types/clock-in';
import type { OfflineClockInItem } from '@/lib/mobile-offline-db';

type ClockInEvent = {
  siteId: string | null;
  freeMissionId: string | null;
  officeLocationId: string | null;
  officeClockInLocation: OfficeClockInLocation | null;
  siteName: string;
  type: ClockInRecordItem['type'];
  timestampLocal: string;
};

type SessionContext =
  | { contextType: 'SITE'; siteId: string }
  | { contextType: 'FREE_MISSION'; freeMissionId: string }
  | { contextType: 'OFFICE'; officeLocationId: string | null; officeClockInLocation: OfficeClockInLocation | null };

export function buildLocalSessionStatus(
  context: SessionContext,
  serverItems: ClockInRecordItem[],
  pendingItems: OfflineClockInItem[],
): SessionStatus {
  const events = [
    ...serverItems.filter((item) => item.status === 'VALID').map(toClockInEvent),
    ...pendingItems.map(toClockInEvent),
  ].sort((left, right) => left.timestampLocal.localeCompare(right.timestampLocal));

  let arrivalTime: string | null = null;
  let openEvent: ClockInEvent | null = null;
  let pauseStartedAt: string | null = null;
  let accumulatedPauseSeconds = 0;

  for (const event of events) {
    if (event.type === 'ARRIVAL') {
      arrivalTime = event.timestampLocal;
      openEvent = event;
      pauseStartedAt = null;
      accumulatedPauseSeconds = 0;
      continue;
    }

    if (event.type === 'PAUSE_START' && arrivalTime && sameContext(openEvent, event) && !pauseStartedAt) {
      pauseStartedAt = event.timestampLocal;
      continue;
    }

    if (event.type === 'PAUSE_END' && arrivalTime && sameContext(openEvent, event) && pauseStartedAt) {
      accumulatedPauseSeconds += elapsedSeconds(pauseStartedAt, event.timestampLocal);
      pauseStartedAt = null;
      continue;
    }

    if (event.type === 'DEPARTURE' && arrivalTime && sameContext(openEvent, event)) {
      arrivalTime = null;
      openEvent = null;
      pauseStartedAt = null;
      accumulatedPauseSeconds = 0;
    }
  }

  if (!arrivalTime || !openEvent || !matchesContext(context, openEvent)) {
    return {
      sessionOpen: false,
      arrivalTime: null,
      duration: null,
      pauseActive: false,
      pauseDuration: 0,
      openSessionSiteId: null,
      openSessionSiteName: null,
      openSessionFreeMissionId: null,
      openSessionPlanningAssignmentId: null,
      openSessionPlanningAssignmentAction: null,
      openSessionContextType: null,
      openSessionOfficeClockInLocation: null,
    };
  }

  const now = new Date().toISOString();
  const activePauseSeconds = pauseStartedAt ? elapsedSeconds(pauseStartedAt, now) : 0;
  const pauseDuration = accumulatedPauseSeconds + activePauseSeconds;
  const contextType = context.contextType;

  return {
    sessionOpen: true,
    arrivalTime,
    duration: Math.max(0, elapsedSeconds(arrivalTime, now) - pauseDuration),
    pauseActive: Boolean(pauseStartedAt),
    pauseDuration,
    openSessionSiteId: openEvent.siteId,
    openSessionSiteName: openEvent.siteName,
    openSessionFreeMissionId: openEvent.freeMissionId,
    openSessionPlanningAssignmentId: null,
    openSessionPlanningAssignmentAction: null,
    openSessionContextType: contextType,
    openSessionOfficeClockInLocation: openEvent.officeClockInLocation,
  };
}

function toClockInEvent(item: ClockInRecordItem | OfflineClockInItem): ClockInEvent {
  return {
    siteId: item.siteId ?? null,
    freeMissionId: 'freeMissionId' in item ? (item.freeMissionId ?? null) : null,
    officeLocationId: 'officeLocationId' in item ? (item.officeLocationId ?? null) : null,
    officeClockInLocation: 'officeClockInLocation' in item ? (item.officeClockInLocation ?? null) : null,
    siteName: item.siteName,
    type: item.type,
    timestampLocal: item.timestampLocal,
  };
}

function sameContext(left: ClockInEvent | null, right: ClockInEvent) {
  if (!left) return false;
  return (
    left.siteId === right.siteId &&
    left.freeMissionId === right.freeMissionId &&
    left.officeLocationId === right.officeLocationId &&
    left.officeClockInLocation === right.officeClockInLocation
  );
}

function matchesContext(context: SessionContext, event: ClockInEvent) {
  if (context.contextType === 'SITE') {
    return event.siteId === context.siteId;
  }

  if (context.contextType === 'FREE_MISSION') {
    return event.freeMissionId === context.freeMissionId;
  }

  return (
    event.officeLocationId === context.officeLocationId &&
    event.officeClockInLocation === context.officeClockInLocation
  );
}

function elapsedSeconds(startedAt: string, endedAt: string) {
  return Math.max(0, Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));
}
