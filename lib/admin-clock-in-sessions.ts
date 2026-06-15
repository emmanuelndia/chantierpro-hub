import { ClockInStatus, ClockInType, Prisma, type PrismaClient } from '@prisma/client';
import type {
  AdminClockInSessionItem,
  AdminClockInSessionsResponse,
  AdminClockInSessionStatus,
} from '@/types/admin-clock-in-sessions';

const clockInSessionRecordSelect = {
  id: true,
  userId: true,
  siteId: true,
  freeMissionId: true,
  planningAssignmentId: true,
  officeLocationId: true,
  officeClockInLocation: true,
  type: true,
  status: true,
  timestampLocal: true,
  latitude: true,
  longitude: true,
  accuracy: true,
  distanceToSite: true,
  comment: true,
  isRemoteCheckout: true,
  isAutoClosed: true,
  isRegularized: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      matricule: true,
      role: true,
    },
  },
  site: {
    select: {
      id: true,
      name: true,
      project: { select: { name: true } },
    },
  },
  freeMission: {
    select: {
      id: true,
      action: true,
      project: { select: { name: true } },
    },
  },
  officeLocation: {
    select: {
      id: true,
      name: true,
    },
  },
  planningAssignment: {
    select: {
      id: true,
      action: true,
      workLocationType: true,
    },
  },
} satisfies Prisma.ClockInRecordSelect;

type ClockInSessionRecord = Prisma.ClockInRecordGetPayload<{
  select: typeof clockInSessionRecordSelect;
}>;

type SessionState = {
  arrival: ClockInSessionRecord;
  timeline: ClockInSessionRecord[];
};

export type AdminClockInSessionQuery = {
  from: Date;
  to: Date;
  userId: string | null;
  context: 'SITE' | 'FREE_MISSION' | 'OFFICE' | null;
  status: AdminClockInSessionStatus | null;
  arrivalRecordId: string | null;
};

export function parseAdminClockInSessionQuery(searchParams: URLSearchParams): AdminClockInSessionQuery {
  const today = new Date();
  const defaultFrom = new Date(`${today.toISOString().slice(0, 10)}T00:00:00.000Z`);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 7);
  const defaultTo = new Date(`${today.toISOString().slice(0, 10)}T23:59:59.999Z`);

  return {
    from: parseDateTime(searchParams.get('from')) ?? defaultFrom,
    to: parseDateTime(searchParams.get('to')) ?? defaultTo,
    userId: sanitizeString(searchParams.get('userId')),
    context: parseContext(searchParams.get('context')),
    status: parseStatus(searchParams.get('status')),
    arrivalRecordId: sanitizeString(searchParams.get('arrivalRecordId')),
  };
}

export async function listAdminClockInSessions(
  prisma: PrismaClient,
  query: AdminClockInSessionQuery,
): Promise<AdminClockInSessionsResponse> {
  if (query.arrivalRecordId) {
    const directSession = await findAdminSessionByArrivalRecordId(prisma, query.arrivalRecordId, query.to);
    const sessions = directSession
      ? [directSession]
          .filter((session) => !query.userId || session.user.id === query.userId)
          .filter((session) => !query.context || session.context === query.context)
          .filter((session) => !query.status || session.status === query.status)
      : [];

    return buildAdminClockInSessionsResponse(sessions, query.arrivalRecordId);
  }

  const baseRecords = await prisma.clockInRecord.findMany({
    where: {
      status: ClockInStatus.VALID,
      type: { in: [ClockInType.ARRIVAL, ClockInType.DEPARTURE, ClockInType.PAUSE_START, ClockInType.PAUSE_END] },
      ...(query.userId ? { userId: query.userId } : {}),
      OR: [
        { timestampLocal: { gte: query.from, lte: query.to } },
        { type: ClockInType.ARRIVAL, timestampLocal: { lt: query.from }, isAutoClosed: false },
      ],
    },
    orderBy: [
      { userId: 'asc' },
      { timestampLocal: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
    select: clockInSessionRecordSelect,
  });
  const records = await completeStaleArrivalRecords(prisma, baseRecords, query.to);

  const sessions = buildAdminSessions(records, query.to)
    .filter((session) => session.arrivalRecord.recordedAt <= query.to.toISOString())
    .filter((session) => sessionOverlapsQuery(session, query))
    .filter((session) => !query.context || session.context === query.context)
    .filter((session) => !query.status || session.status === query.status)
    .sort(compareAdminSessions);

  return buildAdminClockInSessionsResponse(sessions, null);
}

function buildAdminClockInSessionsResponse(
  sessions: AdminClockInSessionItem[],
  arrivalRecordId: string | null,
): AdminClockInSessionsResponse {
  return {
    generatedAt: new Date().toISOString(),
    arrivalRecordId,
    items: sessions,
    summary: {
      total: sessions.length,
      open: sessions.filter((session) => session.status === 'OPEN').length,
      forgotten: sessions.filter((session) => session.status === 'FORGOTTEN_EXIT').length,
      closed: sessions.filter((session) => session.status === 'CLOSED' || session.status === 'CLOSED_BY_ADMIN').length,
      remote: sessions.filter((session) => session.status === 'REMOTE_CHECKOUT').length,
      anomalies: sessions.filter((session) => session.status === 'ANOMALY').length,
    },
  };
}

async function findAdminSessionByArrivalRecordId(
  prisma: PrismaClient,
  arrivalRecordId: string,
  referenceDate: Date,
) {
  const arrival = await prisma.clockInRecord.findFirst({
    where: {
      id: arrivalRecordId,
      type: ClockInType.ARRIVAL,
      status: ClockInStatus.VALID,
    },
    select: clockInSessionRecordSelect,
  });

  if (!arrival) {
    return null;
  }

  const records = await prisma.clockInRecord.findMany({
    where: {
      status: ClockInStatus.VALID,
      userId: arrival.userId,
      siteId: arrival.siteId,
      freeMissionId: arrival.freeMissionId,
      planningAssignmentId: arrival.planningAssignmentId,
      officeLocationId: arrival.officeLocationId,
      officeClockInLocation: arrival.officeClockInLocation,
      type: { in: [ClockInType.ARRIVAL, ClockInType.DEPARTURE, ClockInType.PAUSE_START, ClockInType.PAUSE_END] },
      timestampLocal: { gte: arrival.timestampLocal },
    },
    orderBy: [
      { timestampLocal: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
    select: clockInSessionRecordSelect,
  });

  return buildAdminSessions(records, referenceDate).find((session) => session.sessionId === arrivalRecordId) ?? null;
}

export async function closeClockInSessionAsAdmin(
  prisma: PrismaClient,
  payload: {
    arrivalRecordId: string;
    adminUserId: string;
  },
) {
  const arrival = await prisma.clockInRecord.findFirst({
    where: {
      id: payload.arrivalRecordId,
      type: ClockInType.ARRIVAL,
      status: ClockInStatus.VALID,
    },
  });

  if (!arrival) {
    return { ok: false as const, status: 404, message: 'Session ouverte introuvable.' };
  }

  const nextRecord = await prisma.clockInRecord.findFirst({
    where: {
      userId: arrival.userId,
      siteId: arrival.siteId,
      freeMissionId: arrival.freeMissionId,
      officeLocationId: arrival.officeLocationId,
      officeClockInLocation: arrival.officeClockInLocation,
      planningAssignmentId: arrival.planningAssignmentId,
      status: ClockInStatus.VALID,
      type: { in: [ClockInType.ARRIVAL, ClockInType.DEPARTURE] },
      timestampLocal: { gt: arrival.timestampLocal },
    },
    orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, type: true, timestampLocal: true },
  });

  if (nextRecord?.type === ClockInType.DEPARTURE) {
    return { ok: false as const, status: 400, message: 'Cette session possede deja une sortie.' };
  }

  const now = new Date();
  const closedAt =
    nextRecord?.type === ClockInType.ARRIVAL
      ? new Date(Math.min(now.getTime(), nextRecord.timestampLocal.getTime() - 60_000))
      : now;

  if (closedAt.getTime() <= arrival.timestampLocal.getTime()) {
    return { ok: false as const, status: 400, message: "La sortie doit etre posterieure a l'entree." };
  }

  const comment = 'Sortie fermee par administrateur';
  const departure = await prisma.$transaction(async (tx) => {
    const created = await tx.clockInRecord.create({
      data: {
        siteId: arrival.siteId,
        freeMissionId: arrival.freeMissionId,
        planningAssignmentId: arrival.planningAssignmentId,
        officeLocationId: arrival.officeLocationId,
        officeClockInLocation: arrival.officeClockInLocation,
        userId: arrival.userId,
        type: ClockInType.DEPARTURE,
        clockInDate: new Date(`${closedAt.toISOString().slice(0, 10)}T00:00:00.000Z`),
        clockInTime: closedAt,
        latitude: arrival.latitude,
        longitude: arrival.longitude,
        accuracy: arrival.accuracy,
        distanceToSite: arrival.distanceToSite,
        status: ClockInStatus.VALID,
        comment,
        timestampLocal: closedAt,
        isRemoteCheckout: true,
        isRegularized: true,
      },
      select: { id: true },
    });

    await tx.clockInRecord.update({
      where: { id: arrival.id },
      data: { isRegularized: true },
      select: { id: true },
    });

    await tx.clockInRegularization.create({
      data: {
        clockInRecordId: created.id,
        correctedDepartureTime: closedAt,
        authorId: payload.adminUserId,
        comment,
      },
    });

    return created;
  });

  return { ok: true as const, recordId: departure.id };
}

async function completeStaleArrivalRecords(
  prisma: PrismaClient,
  records: ClockInSessionRecord[],
  to: Date,
) {
  const staleArrivals = records.filter(
    (record) =>
      record.type === ClockInType.ARRIVAL &&
      record.timestampLocal < to &&
      !records.some(
        (candidate) =>
          candidate.id !== record.id &&
          candidate.userId === record.userId &&
          candidate.timestampLocal > record.timestampLocal &&
          candidate.timestampLocal <= to &&
          sameClockInContext(candidate, record),
      ),
  );

  if (staleArrivals.length === 0) {
    return records;
  }

  const supplementalRecords = await prisma.clockInRecord.findMany({
    where: {
      status: ClockInStatus.VALID,
      type: { in: [ClockInType.ARRIVAL, ClockInType.DEPARTURE, ClockInType.PAUSE_START, ClockInType.PAUSE_END] },
      OR: staleArrivals.map((arrival) => ({
        userId: arrival.userId,
        siteId: arrival.siteId,
        freeMissionId: arrival.freeMissionId,
        planningAssignmentId: arrival.planningAssignmentId,
        officeLocationId: arrival.officeLocationId,
        officeClockInLocation: arrival.officeClockInLocation,
        timestampLocal: {
          gt: arrival.timestampLocal,
          lte: to,
        },
      })),
    },
    orderBy: [
      { userId: 'asc' },
      { timestampLocal: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
    select: clockInSessionRecordSelect,
  });

  const byId = new Map<string, ClockInSessionRecord>();
  for (const record of [...records, ...supplementalRecords]) {
    byId.set(record.id, record);
  }

  return [...byId.values()].sort(
    (left, right) =>
      left.userId.localeCompare(right.userId) ||
      left.timestampLocal.getTime() - right.timestampLocal.getTime() ||
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id),
  );
}

function buildAdminSessions(records: ClockInSessionRecord[], referenceDate: Date): AdminClockInSessionItem[] {
  const sessions: AdminClockInSessionItem[] = [];
  const states = new Map<string, SessionState>();

  for (const record of records) {
    const key = buildClockInContextKey(record);
    const state = states.get(key) ?? null;

    if (record.type === ClockInType.ARRIVAL) {
      if (state) {
        sessions.push(toAdminSession(state.arrival, null, state.timeline, referenceDate, true));
      }
      states.set(key, { arrival: record, timeline: [record] });
      continue;
    }

    if (!state) {
      continue;
    }

    state.timeline.push(record);

    if (record.type === ClockInType.DEPARTURE) {
      sessions.push(toAdminSession(state.arrival, record, state.timeline, referenceDate, false));
      states.delete(key);
      continue;
    }

    states.set(key, state);
  }

  for (const state of states.values()) {
    sessions.push(toAdminSession(state.arrival, null, state.timeline, referenceDate, false));
  }

  return sessions;
}

function sessionOverlapsQuery(session: AdminClockInSessionItem, query: AdminClockInSessionQuery) {
  const arrivalTime = new Date(session.arrivalRecord.recordedAt).getTime();
  const departureTime = session.departureRecord ? new Date(session.departureRecord.recordedAt).getTime() : null;
  return arrivalTime <= query.to.getTime() && (departureTime === null || departureTime >= query.from.getTime());
}

function sameClockInContext(left: ClockInSessionRecord, right: ClockInSessionRecord) {
  return (
    left.siteId === right.siteId &&
    left.freeMissionId === right.freeMissionId &&
    left.planningAssignmentId === right.planningAssignmentId &&
    left.officeLocationId === right.officeLocationId &&
    left.officeClockInLocation === right.officeClockInLocation
  );
}

function toAdminSession(
  arrival: ClockInSessionRecord,
  departure: ClockInSessionRecord | null,
  timeline: ClockInSessionRecord[],
  referenceDate: Date,
  interruptedByNewArrival: boolean,
): AdminClockInSessionItem {
  const status = getAdminSessionStatus(arrival, departure, timeline, referenceDate, interruptedByNewArrival);
  const context = getAdminSessionContext(arrival);
  return {
    sessionId: arrival.id,
    user: arrival.user,
    context,
    contextLabel: getContextLabel(arrival),
    projectName: arrival.site?.project.name ?? arrival.freeMission?.project.name ?? null,
    taskAction: arrival.planningAssignment?.action ?? arrival.freeMission?.action ?? null,
    arrivalRecord: serializeRecord(arrival),
    departureRecord: departure ? serializeRecord(departure) : null,
    timeline: timeline.map(serializeRecord),
    status,
    durationSeconds: departure
      ? Math.max(0, Math.round((departure.timestampLocal.getTime() - arrival.timestampLocal.getTime()) / 1000))
      : null,
    isStale: !departure && arrival.timestampLocal.toISOString().slice(0, 10) < referenceDate.toISOString().slice(0, 10),
    isRemoteCheckout: Boolean(departure?.isRemoteCheckout),
    isClosedByAdmin: Boolean(departure?.isRegularized && departure.comment?.includes('administrateur')),
    canClose: !departure,
  };
}

function getAdminSessionStatus(
  arrival: ClockInSessionRecord,
  departure: ClockInSessionRecord | null,
  timeline: ClockInSessionRecord[],
  referenceDate: Date,
  interruptedByNewArrival: boolean,
): AdminClockInSessionStatus {
  if (!departure) {
    if (interruptedByNewArrival || arrival.timestampLocal.toISOString().slice(0, 10) < referenceDate.toISOString().slice(0, 10)) {
      return 'FORGOTTEN_EXIT';
    }
    return 'OPEN';
  }

  if (departure.isRegularized && departure.comment?.includes('administrateur')) return 'CLOSED_BY_ADMIN';
  if (departure.isRemoteCheckout) return 'REMOTE_CHECKOUT';
  if (timeline.some((record) => record.isAutoClosed)) return 'ANOMALY';
  return 'CLOSED';
}

function serializeRecord(record: ClockInSessionRecord) {
  return {
    id: record.id,
    type: record.type,
    recordedAt: record.timestampLocal.toISOString(),
    latitude: record.latitude?.toNumber() ?? null,
    longitude: record.longitude?.toNumber() ?? null,
    accuracy: record.accuracy?.toNumber() ?? null,
    isRemoteCheckout: record.isRemoteCheckout,
    isRegularized: record.isRegularized,
    isAutoClosed: record.isAutoClosed,
    comment: record.comment,
  };
}

function buildClockInContextKey(record: ClockInSessionRecord) {
  if (record.siteId) return `${record.userId}:site:${record.siteId}`;
  if (record.freeMissionId) return `${record.userId}:free:${record.freeMissionId}`;
  if (record.officeLocationId) return `${record.userId}:office:${record.officeLocationId}`;
  if (record.officeClockInLocation) return `${record.userId}:office:${record.officeClockInLocation}`;
  return `${record.userId}:unknown`;
}

function getAdminSessionContext(record: ClockInSessionRecord): AdminClockInSessionItem['context'] {
  if (record.siteId) return 'SITE';
  if (record.freeMissionId) return 'FREE_MISSION';
  return 'OFFICE';
}

function getContextLabel(record: ClockInSessionRecord) {
  if (record.site) return `Chantier - ${record.site.name}`;
  if (record.freeMission) return `Zone - ${record.freeMission.action}`;
  return `Bureau - ${record.officeLocation?.name ?? 'Bureau'}`;
}

function compareAdminSessions(left: AdminClockInSessionItem, right: AdminClockInSessionItem) {
  return right.arrivalRecord.recordedAt.localeCompare(left.arrivalRecord.recordedAt) || left.user.lastName.localeCompare(right.user.lastName);
}

function parseDateTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sanitizeString(value: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed;
}

function parseContext(value: string | null) {
  if (value === 'SITE' || value === 'FREE_MISSION' || value === 'OFFICE') return value;
  return null;
}

function parseStatus(value: string | null): AdminClockInSessionStatus | null {
  const statuses: AdminClockInSessionStatus[] = ['OPEN', 'FORGOTTEN_EXIT', 'CLOSED', 'CLOSED_BY_ADMIN', 'REMOTE_CHECKOUT', 'ANOMALY'];
  return statuses.includes(value as AdminClockInSessionStatus) ? (value as AdminClockInSessionStatus) : null;
}
