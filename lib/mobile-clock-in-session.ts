import type { ClockInRecordItem, SessionStatus } from '@/types/clock-in';
import type { OfflineClockInItem } from '@/lib/mobile-offline-db';

type ClockInEvent = {
  siteId: string;
  siteName: string;
  type: ClockInRecordItem['type'];
  timestampLocal: string;
};

export function buildLocalSessionStatus(
  siteId: string,
  serverItems: ClockInRecordItem[],
  pendingItems: OfflineClockInItem[],
): SessionStatus {
  const events = [
    ...serverItems.filter((item) => item.status === 'VALID').map(toClockInEvent),
    ...pendingItems.map(toClockInEvent),
  ]
    .sort((left, right) => left.timestampLocal.localeCompare(right.timestampLocal));

  let arrivalTime: string | null = null;
  let openSiteId: string | null = null;
  let openSiteName: string | null = null;
  let pauseStartedAt: string | null = null;
  let accumulatedPauseSeconds = 0;

  for (const event of events) {
    if (event.type === 'ARRIVAL') {
      arrivalTime = event.timestampLocal;
      openSiteId = event.siteId;
      openSiteName = event.siteName;
      pauseStartedAt = null;
      accumulatedPauseSeconds = 0;
      continue;
    }

    if (event.type === 'PAUSE_START' && arrivalTime && openSiteId === event.siteId && !pauseStartedAt) {
      pauseStartedAt = event.timestampLocal;
      continue;
    }

    if (event.type === 'PAUSE_END' && arrivalTime && openSiteId === event.siteId && pauseStartedAt) {
      accumulatedPauseSeconds += elapsedSeconds(pauseStartedAt, event.timestampLocal);
      pauseStartedAt = null;
      continue;
    }

    if (event.type === 'DEPARTURE' && arrivalTime && openSiteId === event.siteId) {
      arrivalTime = null;
      openSiteId = null;
      openSiteName = null;
      pauseStartedAt = null;
      accumulatedPauseSeconds = 0;
    }
  }

  if (!arrivalTime) {
    return {
      sessionOpen: false,
      arrivalTime: null,
      duration: null,
      pauseActive: false,
      pauseDuration: 0,
      openSessionSiteId: null,
      openSessionSiteName: null,
    };
  }

  const now = new Date().toISOString();
  const activePauseSeconds = pauseStartedAt ? elapsedSeconds(pauseStartedAt, now) : 0;
  const pauseDuration = accumulatedPauseSeconds + activePauseSeconds;

  return {
    sessionOpen: true,
    arrivalTime,
    duration: Math.max(0, elapsedSeconds(arrivalTime, now) - pauseDuration),
    pauseActive: Boolean(pauseStartedAt),
    pauseDuration,
    openSessionSiteId: openSiteId,
    openSessionSiteName: openSiteName,
  };
}

function toClockInEvent(item: ClockInRecordItem | OfflineClockInItem): ClockInEvent {
  return {
    siteId: item.siteId,
    siteName: item.siteName,
    type: item.type,
    timestampLocal: item.timestampLocal,
  };
}

function elapsedSeconds(startedAt: string, endedAt: string) {
  return Math.max(0, Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));
}
