import { ClockInStatus, ClockInType, Role, type PrismaClient } from '@prisma/client';
import { createInternalPhotoUrl } from '@/lib/photos';
import type {
  MobileHistoryDay,
  MobileHistoryPeriod,
  MobileHistoryPhoto,
  MobileHistoryRecord,
  MobileHistoryReport,
  MobileHistoryResponse,
  MobileHistorySession,
  MobileHistorySessionStatus,
} from '@/types/mobile-history';

type AuthLikeUser = {
  id: string;
  role: Role;
};

type HistoryQuery = {
  period: MobileHistoryPeriod;
  cursor: string | null;
  limit: number;
};

type ClockInRow = {
  id: string;
  siteId: string;
  type: ClockInType;
  status: ClockInStatus;
  distanceToSite: { toNumber(): number };
  comment: string | null;
  timestampLocal: Date;
  site: {
    name: string;
  };
};

type PhotoRow = {
  id: string;
  siteId: string;
  filename: string;
  storageKey: string;
  timestampLocal: Date;
};

type ReportRow = {
  id: string;
  content: string;
  submittedAt: Date;
  clockInRecordId: string;
};

type DraftSession = {
  id: string;
  siteId: string;
  siteName: string;
  records: ClockInRow[];
};

const FIELD_ROLES: readonly Role[] = [Role.SUPERVISOR, Role.COORDINATOR, Role.GENERAL_SUPERVISOR];
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 30;

export function canAccessMobileHistory(role: Role) {
  return FIELD_ROLES.includes(role);
}

export function parseMobileHistoryQuery(searchParams: URLSearchParams): HistoryQuery {
  const period = searchParams.get('period') === 'month' ? 'month' : 'week';
  const cursor = parseCursor(searchParams.get('cursor'));
  const requestedLimit = Number(searchParams.get('limit'));
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, requestedLimit))
    : DEFAULT_LIMIT;

  return {
    period,
    cursor,
    limit,
  };
}

export async function getMobileHistory(
  prisma: PrismaClient,
  user: AuthLikeUser,
  query: HistoryQuery,
): Promise<MobileHistoryResponse> {
  const now = new Date();
  const from = getPeriodStart(now, query.period);

  const [records, photos, reports] = await Promise.all([
    prisma.clockInRecord.findMany({
      where: {
        userId: user.id,
        timestampLocal: {
          gte: from,
          lte: now,
        },
      },
      orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        siteId: true,
        type: true,
        status: true,
        distanceToSite: true,
        comment: true,
        timestampLocal: true,
        site: {
          select: {
            name: true,
          },
        },
      },
    }),
    prisma.photo.findMany({
      where: {
        uploadedById: user.id,
        isDeleted: false,
        timestampLocal: {
          gte: from,
          lte: now,
        },
      },
      orderBy: [{ timestampLocal: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        siteId: true,
        filename: true,
        storageKey: true,
        timestampLocal: true,
      },
    }),
    prisma.report.findMany({
      where: {
        userId: user.id,
        submittedAt: {
          gte: from,
          lte: now,
        },
      },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        content: true,
        submittedAt: true,
        clockInRecordId: true,
      },
    }),
  ]);

  const serializedPhotos = photos.map(serializePhoto);
  const reportByRecordId = new Map(reports.map((report) => [report.clockInRecordId, serializeReport(report)]));
  const allSessions = buildSessions(records, serializedPhotos, reportByRecordId, now).sort(
    (left, right) => right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id),
  );
  const filteredSessions = query.cursor
    ? allSessions.filter((session) => session.startedAt < query.cursor!)
    : allSessions;
  const pageSessions = filteredSessions.slice(0, query.limit);
  const nextCursor =
    filteredSessions.length > query.limit ? pageSessions.at(-1)?.startedAt ?? null : null;

  return {
    period: query.period,
    summary: {
      realDurationSeconds: allSessions.reduce((total, session) => total + session.realDurationSeconds, 0),
      sessionsCount: allSessions.length,
      photosCount: serializedPhotos.length,
    },
    days: groupDays(pageSessions, serializedPhotos),
    nextCursor,
  };
}

function buildSessions(
  records: ClockInRow[],
  photos: MobileHistoryPhoto[],
  reports: Map<string, MobileHistoryReport>,
  now: Date,
) {
  const sessions: MobileHistorySession[] = [];
  const openBySite = new Map<string, DraftSession>();

  for (const record of records) {
    if (record.status !== ClockInStatus.VALID) {
      sessions.push(finalizeSession(
        {
          id: `incomplete:${record.id}`,
          siteId: record.siteId,
          siteName: record.site.name,
          records: [record],
        },
        photos,
        reports,
        now,
      ));
      continue;
    }

    if (record.type === ClockInType.ARRIVAL) {
      const existing = openBySite.get(record.siteId);
      if (existing) {
        sessions.push(finalizeSession(existing, photos, reports, now, 'INCOMPLETE'));
      }

      openBySite.set(record.siteId, {
        id: record.id,
        siteId: record.siteId,
        siteName: record.site.name,
        records: [record],
      });
      continue;
    }

    const current = openBySite.get(record.siteId);

    if (!current) {
      sessions.push(finalizeSession(
        {
          id: `incomplete:${record.id}`,
          siteId: record.siteId,
          siteName: record.site.name,
          records: [record],
        },
        photos,
        reports,
        now,
        'INCOMPLETE',
      ));
      continue;
    }

    current.records.push(record);

    if (record.type === ClockInType.DEPARTURE) {
      sessions.push(finalizeSession(current, photos, reports, now));
      openBySite.delete(record.siteId);
    }
  }

  for (const session of openBySite.values()) {
    sessions.push(finalizeSession(session, photos, reports, now));
  }

  return sessions;
}

function finalizeSession(
  draft: DraftSession,
  photos: MobileHistoryPhoto[],
  reports: Map<string, MobileHistoryReport>,
  now: Date,
  forcedStatus?: MobileHistorySessionStatus,
): MobileHistorySession {
  const arrival = draft.records.find((record) => record.type === ClockInType.ARRIVAL) ?? draft.records[0];
  if (!arrival) {
    throw new Error('Cannot finalize empty mobile history session.');
  }

  const departure = [...draft.records].reverse().find((record) => record.type === ClockInType.DEPARTURE) ?? null;
  const startedAt = arrival.timestampLocal;
  const endedAt = departure?.timestampLocal ?? null;
  const status = forcedStatus ?? getSessionStatus(draft.records, departure);
  const pauseDurationSeconds = calculatePauseDurationSeconds(draft.records, now, Boolean(departure));
  const grossDurationSeconds = Math.max(
    0,
    Math.floor(((endedAt ?? now).getTime() - startedAt.getTime()) / 1000),
  );
  const report =
    [...draft.records]
      .reverse()
      .map((record) => reports.get(record.id) ?? null)
      .find((reportItem) => reportItem !== null) ?? null;
  const sessionPhotos = photos.filter((photo) => {
    const timestamp = new Date(photo.timestampLocal).getTime();
    return (
      photo.siteId === draft.siteId &&
      timestamp >= startedAt.getTime() &&
      timestamp <= (endedAt ?? now).getTime()
    );
  });

  return {
    id: draft.id,
    siteId: draft.siteId,
    siteName: draft.siteName,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt?.toISOString() ?? null,
    status,
    realDurationSeconds: Math.max(0, grossDurationSeconds - pauseDurationSeconds),
    pauseDurationSeconds,
    records: draft.records.map(serializeRecord),
    report,
    photos: sessionPhotos,
  };
}

function getSessionStatus(records: ClockInRow[], departure: ClockInRow | null): MobileHistorySessionStatus {
  const activePause = hasActivePause(records);

  if (activePause) {
    return 'PAUSE_ACTIVE';
  }

  if (departure) {
    return 'COMPLETE';
  }

  if (records.some((record) => record.type === ClockInType.ARRIVAL)) {
    return 'IN_PROGRESS';
  }

  return 'INCOMPLETE';
}

function calculatePauseDurationSeconds(records: ClockInRow[], now: Date, hasDeparture: boolean) {
  let pauseStartedAt: Date | null = null;
  let totalSeconds = 0;

  for (const record of records) {
    if (record.type === ClockInType.PAUSE_START && !pauseStartedAt) {
      pauseStartedAt = record.timestampLocal;
      continue;
    }

    if (record.type === ClockInType.PAUSE_END && pauseStartedAt) {
      totalSeconds += Math.max(0, Math.floor((record.timestampLocal.getTime() - pauseStartedAt.getTime()) / 1000));
      pauseStartedAt = null;
    }
  }

  if (pauseStartedAt && !hasDeparture) {
    totalSeconds += Math.max(0, Math.floor((now.getTime() - pauseStartedAt.getTime()) / 1000));
  }

  return totalSeconds;
}

function hasActivePause(records: ClockInRow[]) {
  let active = false;

  for (const record of records) {
    if (record.type === ClockInType.PAUSE_START) {
      active = true;
      continue;
    }

    if (record.type === ClockInType.PAUSE_END) {
      active = false;
    }
  }

  return active;
}

function groupDays(sessions: MobileHistorySession[], photos: MobileHistoryPhoto[]): MobileHistoryDay[] {
  const days = new Map<string, MobileHistoryDay>();

  for (const session of sessions) {
    const date = session.startedAt.slice(0, 10);
    const day = days.get(date) ?? { date, sessions: [], photos: [] };
    day.sessions.push(session);
    days.set(date, day);
  }

  for (const photo of photos) {
    const date = photo.timestampLocal.slice(0, 10);
    const day = days.get(date);
    if (day) {
      day.photos.push(photo);
    }
  }

  return [...days.values()].sort((left, right) => right.date.localeCompare(left.date));
}

function serializeRecord(record: ClockInRow): MobileHistoryRecord {
  return {
    id: record.id,
    type: record.type,
    status: record.status,
    timestampLocal: record.timestampLocal.toISOString(),
    distanceToSite: record.distanceToSite.toNumber(),
    comment: record.comment,
  };
}

function serializePhoto(photo: PhotoRow): MobileHistoryPhoto {
  return {
    id: photo.id,
    siteId: photo.siteId,
    filename: photo.filename,
    timestampLocal: photo.timestampLocal.toISOString(),
    url: createInternalPhotoUrl(photo.id),
  };
}

function serializeReport(report: ReportRow): MobileHistoryReport {
  return {
    id: report.id,
    content: report.content,
    submittedAt: report.submittedAt.toISOString(),
  };
}

function getPeriodStart(now: Date, period: MobileHistoryPeriod) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (period === 'week' ? 6 : 29));
  return start;
}

function parseCursor(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
