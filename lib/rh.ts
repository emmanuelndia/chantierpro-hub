import ExcelJS from 'exceljs';
import { ClockInStatus, ClockInType, Prisma, Role, type PrismaClient } from '@prisma/client';
import { createSignedStorageUrl, uploadPrivateStorageObject } from '@/lib/storage';
import type {
  RhApiErrorCode,
  RhOptionsResponse,
  RhExportHistoryItem,
  RhExportHistoryResponse,
  RhExportInput,
  RhPresenceSessionItem,
  RhPresenceSummaryItem,
  RhPresencesResponse,
  RhSitePresenceLiveResource,
  RhSitePresenceLiveResponse,
  RhSitePresenceLiveStatus,
  RhUserPresenceDetail,
} from '@/types/rh';

const RH_ALLOWED_ROLES: readonly Role[] = [Role.HR, Role.DIRECTION, Role.ADMIN];
const RH_EXPORT_HISTORY_LIMIT = 20;
const RH_EXPORT_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;

const rhClockInRecordSelect = {
  id: true,
  userId: true,
  siteId: true,
  type: true,
  status: true,
  timestampLocal: true,
  distanceToSite: true,
  comment: true,
  isRemoteCheckout: true,
  isAutoClosed: true,
  isRegularized: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
    },
  },
  site: {
    select: {
      id: true,
      name: true,
      projectId: true,
    },
  },
} satisfies Prisma.ClockInRecordSelect;

const rhExportHistorySelect = {
  id: true,
  createdById: true,
  format: true,
  from: true,
  to: true,
  userId: true,
  projectId: true,
  rowCount: true,
  storageKey: true,
  fileName: true,
  contentType: true,
  expiresAt: true,
  createdAt: true,
  createdBy: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
    },
  },
} satisfies Prisma.RhExportHistorySelect;

type AuthLikeUser = {
  id: string;
  role: Role;
};

type SerializableRhClockInRecord = Prisma.ClockInRecordGetPayload<{
  select: typeof rhClockInRecordSelect;
}>;

type SerializableRhExportHistory = Prisma.RhExportHistoryGetPayload<{
  select: typeof rhExportHistorySelect;
}>;

type SessionBuildState = {
  arrival: SerializableRhClockInRecord | null;
  activePauseStartedAt: Date | null;
  accumulatedPauseMs: number;
};

type BuiltSession = {
  arrivalRecordId: string;
  departureRecordId: string | null;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  siteId: string;
  siteName: string;
  projectId: string;
  date: string;
  arrivalTime: string;
  departureTime: string | null;
  realDurationHours: number | null;
  pauseDurationHours: number;
  distanceMeters: number;
  comment: string | null;
  status: 'COMPLETE' | 'INCOMPLETE_SESSION' | 'TO_REGULARIZE' | 'TO_REVIEW_RH';
  incomplete: boolean;
  isRemoteCheckout: boolean;
  isAutoClosed: boolean;
  isRegularized: boolean;
  startedAt: string;
};

type MonthlyPresenceQuery = {
  month: number;
  year: number;
  userId: string | null;
  projectId: string | null;
  siteIds: string[];
  search: string | null;
};

type UserPresenceQuery = {
  month: number;
  year: number;
  projectId: string | null;
  siteIds: string[];
};

type ExportQuery = {
  format: 'csv' | 'xlsx';
  from: string;
  to: string;
  userId: string | null;
  projectId: string | null;
  siteIds: string[];
};

type SitePresenceLiveQuery = {
  projectId: string | null;
  siteId: string | null;
  resourceId: string | null;
  role: Role | null;
  status: RhSitePresenceLiveStatus | null;
  search: string | null;
  anomaliesOnly: boolean;
};

type ExportArtifact = {
  contentType: string;
  fileName: string;
  buffer: Buffer;
  rowCount: number;
  storageKey: string;
  expiresAt: string;
};

type ExportRow = {
  lastName: string;
  firstName: string;
  email: string;
  siteName: string;
  date: string;
  arrivalTime: string;
  departureTime: string;
  realDurationHours: string;
  pauseDurationHours: string;
  distanceMeters: string;
  status: string;
};

export function jsonRhError(code: RhApiErrorCode, status: number, message: string) {
  return Response.json(
    {
      code,
      message,
    },
    { status },
  );
}

export function canAccessRh(role: Role) {
  return RH_ALLOWED_ROLES.includes(role);
}

export function parseMonthlyPresenceQuery(searchParams: URLSearchParams): MonthlyPresenceQuery | null {
  const month = parseMonth(searchParams.get('month'));
  const year = parseYear(searchParams.get('year'));

  if (month === null || year === null) {
    return null;
  }

  return {
    month,
    year,
    userId: sanitizeString(searchParams.get('userId')),
    projectId: sanitizeString(searchParams.get('projectId')),
    siteIds: parseCsvList(searchParams.get('siteIds')),
    search: sanitizeString(searchParams.get('search')),
  };
}

export function parseUserPresenceQuery(searchParams: URLSearchParams): UserPresenceQuery {
  const currentDate = new Date();

  return {
    month: parseMonth(searchParams.get('month')) ?? currentDate.getUTCMonth() + 1,
    year: parseYear(searchParams.get('year')) ?? currentDate.getUTCFullYear(),
    projectId: sanitizeString(searchParams.get('projectId')),
    siteIds: parseCsvList(searchParams.get('siteIds')),
  };
}

export function parseRhExportInput(body: unknown): RhExportInput | null {
  if (!isRecord(body)) {
    return null;
  }

  const format = parseExportFormat(body.format);
  const from = sanitizeDateTimeString(body.from);
  const to = sanitizeDateTimeString(body.to);
  const userId = body.userId === undefined || body.userId === null ? null : sanitizeString(body.userId);
  const projectId =
    body.projectId === undefined || body.projectId === null ? null : sanitizeString(body.projectId);
  const siteIds = Array.isArray(body.siteIds)
    ? body.siteIds.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];

  if (!format || !from || !to) {
    return null;
  }

  if (new Date(from).getTime() > new Date(to).getTime()) {
    return null;
  }

  return {
    format,
    from,
    to,
    userId,
    projectId,
    siteIds,
  };
}

export function parseSitePresenceLiveQuery(searchParams: URLSearchParams): SitePresenceLiveQuery {
  return {
    projectId: sanitizeString(searchParams.get('projectId')),
    siteId: sanitizeString(searchParams.get('siteId')),
    resourceId: sanitizeString(searchParams.get('resourceId')),
    role: parseRole(searchParams.get('role')),
    status: parseLiveStatus(searchParams.get('status')),
    search: sanitizeString(searchParams.get('q')),
    anomaliesOnly: searchParams.get('anomaliesOnly') === 'true',
  };
}

export async function getSitePresencesLive(
  prisma: PrismaClient,
  query: SitePresenceLiveQuery,
): Promise<RhSitePresenceLiveResponse> {
  const today = toDateOnlyDate(new Date());
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const siteWhere: Prisma.SiteWhereInput = {
    status: 'ACTIVE',
    project: {
      status: {
        not: 'ARCHIVED',
      },
    },
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.siteId ? { id: query.siteId } : {}),
  };

  const [sites, assignments, records] = await Promise.all([
    prisma.site.findMany({
      where: siteWhere,
      orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        address: true,
        projectId: true,
        project: {
          select: {
            name: true,
          },
        },
      },
    }),
    prisma.planningAssignment.findMany({
      where: {
        date: today,
        deletedAt: null,
        workLocationType: 'ON_SITE',
        site: siteWhere,
        ...(query.resourceId ? { supervisorId: query.resourceId } : {}),
        ...(query.role ? { supervisor: { role: query.role } } : {}),
      },
      orderBy: [{ site: { project: { name: 'asc' } } }, { site: { name: 'asc' } }, { supervisor: { firstName: 'asc' } }],
      select: {
        id: true,
        siteId: true,
        action: true,
        supervisorId: true,
        supervisor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    }),
    prisma.clockInRecord.findMany({
      where: {
        status: ClockInStatus.VALID,
        site: siteWhere,
        timestampLocal: {
          gte: today,
          lt: tomorrow,
        },
        type: {
          in: [ClockInType.ARRIVAL, ClockInType.DEPARTURE, ClockInType.PAUSE_START, ClockInType.PAUSE_END],
        },
        ...(query.resourceId ? { userId: query.resourceId } : {}),
        ...(query.role ? { user: { role: query.role } } : {}),
      },
      orderBy: [{ site: { project: { name: 'asc' } } }, { site: { name: 'asc' } }, { user: { firstName: 'asc' } }, { timestampLocal: 'asc' }],
      select: {
        id: true,
        userId: true,
        siteId: true,
        type: true,
        timestampLocal: true,
        distanceToSite: true,
        isRemoteCheckout: true,
        isAutoClosed: true,
        isRegularized: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
    }),
  ]);

  const siteRows = new Map(
    sites.map((site) => [
      site.id,
      {
        siteId: site.id,
        siteName: site.name,
        siteAddress: site.address,
        projectId: site.projectId,
        projectName: site.project.name,
        expectedCount: 0,
        presentCount: 0,
        pausedCount: 0,
        notClockedCount: 0,
        leftCount: 0,
        anomalyCount: 0,
        lastActivityAt: null as string | null,
        resources: [] as RhSitePresenceLiveResource[],
      },
    ]),
  );

  const recordsBySiteUser = new Map<string, typeof records>();
  for (const record of records) {
    const key = liveResourceKey(record.siteId, record.userId);
    recordsBySiteUser.set(key, [...(recordsBySiteUser.get(key) ?? []), record]);
  }

  const assignmentBySiteUser = new Map<string, (typeof assignments)[number]>();
  for (const assignment of assignments) {
    const key = liveResourceKey(assignment.siteId, assignment.supervisorId);
    const existing = assignmentBySiteUser.get(key);
    assignmentBySiteUser.set(key, existing ? { ...existing, action: `${existing.action} / ${assignment.action}` } : assignment);
  }

  const allKeys = new Set([...recordsBySiteUser.keys(), ...assignmentBySiteUser.keys()]);
  const resourcesById = new Map<string, { id: string; label: string; role: Role }>();
  const roles = new Set<Role>();

  for (const key of allKeys) {
    const [siteId] = key.split(':');
    const site = siteId ? siteRows.get(siteId) : null;
    if (!site) continue;

    const siteRecords = recordsBySiteUser.get(key) ?? [];
    const assignment = assignmentBySiteUser.get(key) ?? null;
    const user = assignment?.supervisor ?? siteRecords[0]?.user;
    if (!user) continue;

    const resource = buildLiveResource(user, assignment?.action ?? null, siteRecords);
    if (!matchesLiveResourceFilters(resource, query)) continue;

    site.resources.push(resource);
    roles.add(user.role);
    resourcesById.set(user.id, {
      id: user.id,
      label: `${user.firstName} ${user.lastName}`,
      role: user.role,
    });

    if (assignment) site.expectedCount += 1;
    if (resource.status === 'PRESENT') site.presentCount += 1;
    if (resource.status === 'PAUSED') site.pausedCount += 1;
    if (resource.status === 'EXPECTED_NOT_CLOCKED') site.notClockedCount += 1;
    if (resource.status === 'LEFT') site.leftCount += 1;
    if (resource.status === 'ANOMALY') site.anomalyCount += 1;

    if (resource.lastClockInAt && (!site.lastActivityAt || resource.lastClockInAt > site.lastActivityAt)) {
      site.lastActivityAt = resource.lastClockInAt;
    }
  }

  const filteredSites = [...siteRows.values()]
    .filter((site) => !query.anomaliesOnly || site.anomalyCount > 0)
    .filter((site) => {
      if (!query.status) return true;
      return site.resources.some((resource) => resource.status === query.status);
    })
    .filter((site) => {
      if (!query.search) return true;
      const normalized = query.search.toLowerCase();
      return `${site.projectName} ${site.siteName} ${site.siteAddress}`.toLowerCase().includes(normalized) || site.resources.length > 0;
    })
    .map((site) => ({
      ...site,
      resources: site.resources.sort(compareLiveResource),
    }));

  return {
    generatedAt: new Date().toISOString(),
    date: today.toISOString().slice(0, 10),
    summary: {
      activeSites: sites.length,
      expectedResources: filteredSites.reduce((sum, site) => sum + site.expectedCount, 0),
      presentResources: filteredSites.reduce((sum, site) => sum + site.presentCount, 0),
      pausedResources: filteredSites.reduce((sum, site) => sum + site.pausedCount, 0),
      notClockedResources: filteredSites.reduce((sum, site) => sum + site.notClockedCount, 0),
      anomalies: filteredSites.reduce((sum, site) => sum + site.anomalyCount, 0),
    },
    options: {
      projects: sites
        .map((site) => ({ id: site.projectId, label: site.project.name }))
        .filter(uniqueOption)
        .sort((a, b) => a.label.localeCompare(b.label)),
      sites: sites
        .map((site) => ({ id: site.id, label: site.name, projectId: site.projectId }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      resources: [...resourcesById.values()]
        .map((resource) => ({ id: resource.id, label: resource.label, role: resource.role }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      roles: [...roles].sort(),
    },
    sites: filteredSites,
  };
}

export async function getMonthlyRhPresences(
  prisma: PrismaClient,
  query: MonthlyPresenceQuery,
): Promise<RhPresencesResponse> {
  const sessions = await getBuiltSessionsForRange(prisma, {
    from: monthRangeStart(query.year, query.month),
    to: monthRangeEnd(query.year, query.month),
    userId: query.userId,
    projectId: query.projectId,
    siteIds: query.siteIds,
  });

  const grouped = new Map<string, BuiltSession[]>();

  for (const session of sessions) {
    grouped.set(session.userId, [...(grouped.get(session.userId) ?? []), session]);
  }

  const search = query.search;
  const filteredGroups = search
    ? [...grouped.values()].filter((userSessions) => matchesRhSearch(userSessions[0]!, search))
    : [...grouped.values()];

  const items: RhPresenceSummaryItem[] = filteredGroups
    .map((userSessions) => buildPresenceSummary(userSessions))
    .sort(comparePresenceSummary);

  const totalHours = roundHours(items.reduce((sum, item) => sum + item.totalHours, 0));
  const activeResources = items.length;
  const sitesCount = new Set(sessions.map((session) => session.siteId)).size;
  const incompleteSessions = items.reduce((sum, item) => sum + item.incompleteSessions, 0);

  return {
    month: query.month,
    year: query.year,
    summary: {
      totalHours,
      activeResources,
      sitesCount,
      incompleteSessions,
    },
    items,
  };
}

export async function getRhPresenceDetailForUser(
  prisma: PrismaClient,
  payload: {
    userId: string;
    query: UserPresenceQuery;
  },
): Promise<RhUserPresenceDetail | null> {
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  });

  if (!user) {
    return null;
  }

  const sessions = await getBuiltSessionsForRange(prisma, {
    from: monthRangeStart(payload.query.year, payload.query.month),
    to: monthRangeEnd(payload.query.year, payload.query.month),
    userId: payload.userId,
    projectId: payload.query.projectId,
    siteIds: payload.query.siteIds,
  });

  const sortedSessions = sessions
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.siteId.localeCompare(right.siteId))
    .map(serializeRhPresenceSession);

  return {
    userId: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    month: payload.query.month,
    year: payload.query.year,
    sessions: sortedSessions,
  };
}

export async function regularizeRhSession(
  prisma: PrismaClient,
  payload: {
    arrivalRecordId: string;
    departureRecordId: string | null;
    correctedDepartureTime: string;
    comment: string;
    author: AuthLikeUser;
  },
) {
  if (!canAccessRh(payload.author.role)) {
    return { code: 'FORBIDDEN' as const, recordId: null };
  }

  const comment = payload.comment.trim();
  const correctedDepartureTime = new Date(payload.correctedDepartureTime);

  if (!comment || Number.isNaN(correctedDepartureTime.getTime())) {
    return { code: 'BAD_REQUEST' as const, recordId: null };
  }

  const arrival = await prisma.clockInRecord.findUnique({
    where: { id: payload.arrivalRecordId },
    select: {
      id: true,
      siteId: true,
      userId: true,
      type: true,
      status: true,
      clockInDate: true,
      latitude: true,
      longitude: true,
      accuracy: true,
      distanceToSite: true,
      timestampLocal: true,
    },
  });

  if (arrival?.type !== ClockInType.ARRIVAL || arrival.status !== ClockInStatus.VALID) {
    return { code: 'NOT_FOUND' as const, recordId: null };
  }

  if (correctedDepartureTime.getTime() <= arrival.timestampLocal.getTime()) {
    return { code: 'BAD_REQUEST' as const, recordId: null };
  }

  if (payload.departureRecordId) {
    const departure = await prisma.clockInRecord.findFirst({
      where: {
        id: payload.departureRecordId,
        userId: arrival.userId,
        siteId: arrival.siteId,
        status: ClockInStatus.VALID,
        type: ClockInType.DEPARTURE,
        timestampLocal: {
          gt: arrival.timestampLocal,
        },
      },
      select: { id: true },
    });

    if (!departure) {
      return { code: 'NOT_FOUND' as const, recordId: null };
    }

    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.clockInRecord.update({
        where: { id: departure.id },
        data: {
          clockInDate: new Date(`${correctedDepartureTime.toISOString().slice(0, 10)}T00:00:00.000Z`),
          clockInTime: correctedDepartureTime,
          timestampLocal: correctedDepartureTime,
          comment,
          isRegularized: true,
        },
        select: { id: true },
      });

      await tx.clockInRegularization.create({
        data: {
          clockInRecordId: record.id,
          correctedDepartureTime,
          authorId: payload.author.id,
          comment,
        },
      });

      await tx.clockInRecord.update({
        where: { id: arrival.id },
        data: { isRegularized: true },
        select: { id: true },
      });

      return record;
    });

    return { code: null, recordId: updated.id };
  }

  const existingDeparture = await prisma.clockInRecord.findFirst({
    where: {
      userId: arrival.userId,
      siteId: arrival.siteId,
      status: ClockInStatus.VALID,
      type: ClockInType.DEPARTURE,
      timestampLocal: {
        gt: arrival.timestampLocal,
      },
    },
    orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });

  if (existingDeparture) {
    return { code: 'BAD_REQUEST' as const, recordId: null };
  }

  const departure = await prisma.$transaction(async (tx) => {
    const created = await tx.clockInRecord.create({
      data: {
        siteId: arrival.siteId,
        userId: arrival.userId,
        type: ClockInType.DEPARTURE,
        clockInDate: new Date(`${correctedDepartureTime.toISOString().slice(0, 10)}T00:00:00.000Z`),
        clockInTime: correctedDepartureTime,
        latitude: arrival.latitude,
        longitude: arrival.longitude,
        accuracy: arrival.accuracy,
        distanceToSite: arrival.distanceToSite,
        status: ClockInStatus.VALID,
        comment,
        timestampLocal: correctedDepartureTime,
        isRegularized: true,
      },
      select: { id: true },
    });

    await tx.clockInRegularization.create({
      data: {
        clockInRecordId: created.id,
        correctedDepartureTime,
        authorId: payload.author.id,
        comment,
      },
    });

    await tx.clockInRecord.update({
      where: { id: arrival.id },
      data: { isRegularized: true },
      select: { id: true },
    });

    return created;
  });

  return { code: null, recordId: departure.id };
}


export async function buildRhExportArtifact(
  prisma: PrismaClient,
  payload: {
    createdBy: AuthLikeUser;
    input: ExportQuery;
  },
): Promise<ExportArtifact> {
  const sessions = await getBuiltSessionsForRange(prisma, {
    from: new Date(payload.input.from),
    to: new Date(payload.input.to),
    userId: payload.input.userId,
    projectId: payload.input.projectId,
    siteIds: payload.input.siteIds,
  });

  const grouped = new Map<string, BuiltSession[]>();

  for (const session of sessions) {
    grouped.set(session.userId, [...(grouped.get(session.userId) ?? []), session]);
  }

  const sortedUsers = [...grouped.values()].sort((left, right) => compareBuiltSession(left[0]!, right[0]!));
  const rows: ExportRow[] = [];
  let totalGeneralHours = 0;
  let totalGeneralPauseHours = 0;

  for (const userSessions of sortedUsers) {
    const orderedSessions = [...userSessions].sort(compareBuiltSession);
    let employeeTotalHours = 0;
    let employeePauseHours = 0;

    for (const session of orderedSessions) {
      employeeTotalHours += session.realDurationHours ?? 0;
      employeePauseHours += session.pauseDurationHours;

      rows.push({
        lastName: session.lastName,
        firstName: session.firstName,
        email: session.email,
        siteName: session.siteName,
        date: session.date,
        arrivalTime: session.arrivalTime,
        departureTime: session.departureTime ?? '',
        realDurationHours:
          session.realDurationHours === null ? '' : formatHours(session.realDurationHours),
        pauseDurationHours: formatHours(session.pauseDurationHours),
        distanceMeters: String(session.distanceMeters),
        status: session.status,
      });
    }

    totalGeneralHours += employeeTotalHours;
    totalGeneralPauseHours += employeePauseHours;

    const owner = orderedSessions[0]!;
    rows.push({
      lastName: owner.lastName,
      firstName: owner.firstName,
      email: owner.email,
      siteName: 'TOTAL EMPLOYE',
      date: '',
      arrivalTime: '',
      departureTime: '',
      realDurationHours: formatHours(employeeTotalHours),
      pauseDurationHours: formatHours(employeePauseHours),
      distanceMeters: '',
      status: '',
    });
  }

  rows.push({
    lastName: '',
    firstName: '',
    email: '',
    siteName: 'TOTAL GENERAL',
    date: '',
    arrivalTime: '',
    departureTime: '',
    realDurationHours: formatHours(totalGeneralHours),
    pauseDurationHours: formatHours(totalGeneralPauseHours),
    distanceMeters: '',
    status: '',
  });

  const fileBaseName = `rh-export-${payload.input.from.slice(0, 10)}-${payload.input.to.slice(0, 10)}`;

  if (payload.input.format === 'csv') {
    const buffer = buildCsvBuffer(rows);
    const fileName = `${fileBaseName}.csv`;
    const storageKey = buildRhExportStorageKey(fileName);
    const expiresAt = new Date(Date.now() + RH_EXPORT_ARTIFACT_TTL_MS).toISOString();

    await uploadPrivateStorageObject({
      storageKey,
      body: buffer,
      contentType: 'text/csv; charset=utf-8',
    });

    return {
      contentType: 'text/csv; charset=utf-8',
      fileName,
      buffer,
      rowCount: sessions.length,
      storageKey,
      expiresAt,
    };
  }

  const buffer = await buildXlsxBuffer(rows);
  const fileName = `${fileBaseName}.xlsx`;
  const storageKey = buildRhExportStorageKey(fileName);
  const expiresAt = new Date(Date.now() + RH_EXPORT_ARTIFACT_TTL_MS).toISOString();

  await uploadPrivateStorageObject({
    storageKey,
    body: buffer,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  return {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName,
    buffer,
    rowCount: sessions.length,
    storageKey,
    expiresAt,
  };
}

export async function logRhExport(
  prisma: PrismaClient,
  payload: {
    createdById: string;
    input: ExportQuery;
    rowCount: number;
    storageKey: string;
    fileName: string;
    contentType: string;
    expiresAt: string;
  },
) {
  await prisma.rhExportHistory.create({
    data: {
      createdById: payload.createdById,
      format: payload.input.format === 'csv' ? 'CSV' : 'XLSX',
      from: new Date(payload.input.from),
      to: new Date(payload.input.to),
      userId: payload.input.userId,
      projectId: payload.input.projectId,
      rowCount: payload.rowCount,
      storageKey: payload.storageKey,
      fileName: payload.fileName,
      contentType: payload.contentType,
      expiresAt: new Date(payload.expiresAt),
    },
  });
}

export async function getRhExportHistory(prisma: PrismaClient): Promise<RhExportHistoryResponse> {
  const items = await prisma.rhExportHistory.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: RH_EXPORT_HISTORY_LIMIT,
    select: rhExportHistorySelect,
  });

  return {
    items: items.map(serializeRhExportHistory),
  };
}

export async function getRhExportDownloadArtifact(
  prisma: PrismaClient,
  exportId: string,
) {
  const item = await prisma.rhExportHistory.findUnique({
    where: {
      id: exportId,
    },
    select: rhExportHistorySelect,
  });

  if (!item) {
    return null;
  }

  const expiresAt = item.expiresAt ? new Date(item.expiresAt) : null;

  if (!item.storageKey || !item.fileName || !item.contentType || !expiresAt) {
    return {
      state: 'expired' as const,
      item,
    };
  }

  if (expiresAt.getTime() <= Date.now()) {
    return {
      state: 'expired' as const,
      item,
    };
  }

  const signedUrl = await createSignedStorageUrl(item.storageKey);

  return {
    state: 'available' as const,
    item,
    signedUrl,
  };
}

export async function getRhOptions(prisma: PrismaClient): Promise<RhOptionsResponse> {
  const [projects, sites, resources] = await Promise.all([
    prisma.project.findMany({
      where: {
        status: {
          not: 'ARCHIVED',
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.site.findMany({
      where: {
        project: {
          status: {
            not: 'ARCHIVED',
          },
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        projectId: true,
      },
    }),
    prisma.user.findMany({
      where: {
        isActive: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    }),
  ]);

  return {
    projects: projects.map((project) => ({
      id: project.id,
      label: project.name,
    })),
    sites: sites.map((site) => ({
      id: site.id,
      label: site.name,
      projectId: site.projectId,
    })),
    resources: resources.map((resource) => ({
      id: resource.id,
      label: `${resource.firstName} ${resource.lastName}`,
      role: resource.role,
    })),
  };
}

async function getBuiltSessionsForRange(
  prisma: PrismaClient,
  payload: {
    from: Date;
    to: Date;
    userId: string | null;
    projectId: string | null;
    siteIds: string[];
  },
) {
  const records = await prisma.clockInRecord.findMany({
    where: {
      status: ClockInStatus.VALID,
      type: {
        in: [
          ClockInType.ARRIVAL,
          ClockInType.DEPARTURE,
          ClockInType.PAUSE_START,
          ClockInType.PAUSE_END,
        ],
      },
      timestampLocal: {
        gte: payload.from,
        lte: payload.to,
      },
      ...(payload.userId
        ? {
            userId: payload.userId,
          }
        : {}),
      ...(payload.projectId
        ? {
            site: {
              projectId: payload.projectId,
            },
          }
        : {}),
      ...(payload.siteIds.length > 0
        ? {
            siteId: {
              in: payload.siteIds,
            },
          }
        : {}),
    },
    orderBy: [
      { userId: 'asc' },
      { siteId: 'asc' },
      { timestampLocal: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
    select: rhClockInRecordSelect,
  });

  return buildSessions(records);
}

function buildSessions(records: SerializableRhClockInRecord[]) {
  const sessions: BuiltSession[] = [];
  const states = new Map<string, SessionBuildState>();

  for (const record of records) {
    const key = `${record.userId}:${record.siteId}`;
    const state = states.get(key) ?? {
      arrival: null,
      activePauseStartedAt: null,
      accumulatedPauseMs: 0,
    };

    if (record.type === ClockInType.ARRIVAL) {
      if (state.arrival) {
        sessions.push(buildIncompleteSession(state.arrival, state.accumulatedPauseMs));
      }

      states.set(key, {
        arrival: record,
        activePauseStartedAt: null,
        accumulatedPauseMs: 0,
      });
      continue;
    }

    if (!state.arrival) {
      continue;
    }

    if (record.type === ClockInType.PAUSE_START) {
      state.activePauseStartedAt ??= record.timestampLocal;

      states.set(key, state);
      continue;
    }

    if (record.type === ClockInType.PAUSE_END) {
      if (state.activePauseStartedAt) {
        state.accumulatedPauseMs += Math.max(
          0,
          record.timestampLocal.getTime() - state.activePauseStartedAt.getTime(),
        );
        state.activePauseStartedAt = null;
      }

      states.set(key, state);
      continue;
    }

    if (record.type === ClockInType.DEPARTURE) {
      sessions.push(buildCompleteSession(state.arrival, record, state.accumulatedPauseMs));
      states.set(key, {
        arrival: null,
        activePauseStartedAt: null,
        accumulatedPauseMs: 0,
      });
    }
  }

  for (const state of states.values()) {
    if (state.arrival) {
      sessions.push(buildIncompleteSession(state.arrival, state.accumulatedPauseMs));
    }
  }

  return sessions;
}

function buildCompleteSession(
  arrival: SerializableRhClockInRecord,
  departure: SerializableRhClockInRecord,
  accumulatedPauseMs: number,
): BuiltSession {
  const durationMs = Math.max(0, departure.timestampLocal.getTime() - arrival.timestampLocal.getTime());
  const realDurationHours = roundHours((durationMs - accumulatedPauseMs) / 3_600_000);
  const pauseDurationHours = roundHours(accumulatedPauseMs / 3_600_000);
  const needsReview = departure.isRemoteCheckout && realDurationHours > 6;

  return {
    arrivalRecordId: arrival.id,
    departureRecordId: departure.id,
    userId: arrival.userId,
    firstName: arrival.user.firstName,
    lastName: arrival.user.lastName,
    email: arrival.user.email,
    role: arrival.user.role,
    siteId: arrival.siteId,
    siteName: arrival.site.name,
    projectId: arrival.site.projectId,
    date: arrival.timestampLocal.toISOString().slice(0, 10),
    arrivalTime: arrival.timestampLocal.toISOString().slice(11, 19),
    departureTime: departure.timestampLocal.toISOString().slice(11, 19),
    realDurationHours,
    pauseDurationHours,
    distanceMeters: Math.round(arrival.distanceToSite.toNumber() * 1000),
    comment: departure?.comment ?? arrival.comment,
    status: needsReview ? 'TO_REVIEW_RH' : 'COMPLETE',
    incomplete: false,
    isRemoteCheckout: departure.isRemoteCheckout,
    isAutoClosed: departure.isAutoClosed,
    isRegularized: departure.isRegularized,
    startedAt: arrival.timestampLocal.toISOString(),
  };
}

function buildIncompleteSession(
  arrival: SerializableRhClockInRecord,
  accumulatedPauseMs: number,
): BuiltSession {
  const isPreviousDay = arrival.timestampLocal.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10);

  return {
    arrivalRecordId: arrival.id,
    departureRecordId: null,
    userId: arrival.userId,
    firstName: arrival.user.firstName,
    lastName: arrival.user.lastName,
    email: arrival.user.email,
    role: arrival.user.role,
    siteId: arrival.siteId,
    siteName: arrival.site.name,
    projectId: arrival.site.projectId,
    date: arrival.timestampLocal.toISOString().slice(0, 10),
    arrivalTime: arrival.timestampLocal.toISOString().slice(11, 19),
    departureTime: null,
    realDurationHours: null,
    pauseDurationHours: roundHours(accumulatedPauseMs / 3_600_000),
    distanceMeters: Math.round(arrival.distanceToSite.toNumber() * 1000),
    comment: arrival.comment,
    status: isPreviousDay || arrival.isAutoClosed ? 'TO_REGULARIZE' : 'INCOMPLETE_SESSION',
    incomplete: true,
    isRemoteCheckout: false,
    isAutoClosed: isPreviousDay || arrival.isAutoClosed,
    isRegularized: arrival.isRegularized,
    startedAt: arrival.timestampLocal.toISOString(),
  };
}

function buildPresenceSummary(sessions: BuiltSession[]): RhPresenceSummaryItem {
  const orderedSessions = [...sessions].sort(compareBuiltSession);
  const owner = orderedSessions[0]!;
  let totalHours = 0;
  let nbSessions = 0;
  let incompleteSessions = 0;
  let totalPauseDuration = 0;
  const workedDays = new Set<string>();
  const siteIds = new Set<string>();
  let lastSite: string | null = null;

  for (const session of orderedSessions) {
    totalPauseDuration += session.pauseDurationHours;
    lastSite = session.siteName;
    siteIds.add(session.siteId);

    if (session.incomplete) {
      incompleteSessions += 1;
      continue;
    }

    totalHours += session.realDurationHours ?? 0;
    nbSessions += 1;
    workedDays.add(session.date);
  }

  const avgHoursPerDay = workedDays.size === 0 ? 0 : roundHours(totalHours / workedDays.size);

  return {
    userId: owner.userId,
    firstName: owner.firstName,
    lastName: owner.lastName,
    email: owner.email,
    role: owner.role,
    nbDays: workedDays.size,
    totalHours: roundHours(totalHours),
    nbSessions,
    avgHoursPerDay,
    lastSite,
    incompleteSessions,
    totalPauseDuration: roundHours(totalPauseDuration),
    sitesCount: siteIds.size,
  };
}

function serializeRhPresenceSession(session: BuiltSession): RhPresenceSessionItem {
  return {
    arrivalRecordId: session.arrivalRecordId,
    departureRecordId: session.departureRecordId,
    date: session.date,
    siteId: session.siteId,
    siteName: session.siteName,
    arrivalTime: session.arrivalTime,
    departureTime: session.departureTime,
    realDurationHours: session.realDurationHours,
    pauseDurationHours: session.pauseDurationHours,
    distanceMeters: session.distanceMeters,
    comment: session.comment,
    status: session.status,
    incomplete: session.incomplete,
    isRemoteCheckout: session.isRemoteCheckout,
    isAutoClosed: session.isAutoClosed,
    isRegularized: session.isRegularized,
  };
}

function serializeRhExportHistory(item: SerializableRhExportHistory): RhExportHistoryItem {
  const expiresAt = item.expiresAt ? new Date(item.expiresAt) : null;
  const isAvailable = Boolean(item.storageKey && expiresAt && expiresAt.getTime() > Date.now());

  return {
    id: item.id,
    createdById: item.createdById,
    format: item.format === 'CSV' ? 'csv' : 'xlsx',
    from: item.from.toISOString(),
    to: item.to.toISOString(),
    userId: item.userId,
    projectId: item.projectId,
    rowCount: item.rowCount,
    fileName: item.fileName,
    contentType: item.contentType,
    expiresAt: expiresAt?.toISOString() ?? null,
    isAvailable,
    downloadUrl: isAvailable ? `/api/rh/exports/${item.id}/download` : null,
    createdAt: item.createdAt.toISOString(),
    createdBy: {
      id: item.createdBy.id,
      firstName: item.createdBy.firstName,
      lastName: item.createdBy.lastName,
      role: item.createdBy.role,
    },
  };
}

function buildCsvBuffer(rows: ExportRow[]) {
  const headers = [
    'Nom',
    'Prénom',
    'Email',
    'Chantier',
    'Date',
    'Heure entrée',
    'Heure sortie',
    'Durée réelle (h)',
    'Durée pauses (h)',
    'Distance (m)',
    'Statut',
  ];

  const lines = [
    headers.join(','),
    ...rows.map((row) =>
      [
        row.lastName,
        row.firstName,
        row.email,
        row.siteName,
        row.date,
        row.arrivalTime,
        row.departureTime,
        row.realDurationHours,
        row.pauseDurationHours,
        row.distanceMeters,
        row.status,
      ]
        .map(escapeCsvValue)
        .join(','),
    ),
  ];

  return Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
}

async function buildXlsxBuffer(rows: ExportRow[]) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Presences RH');

  worksheet.columns = [
    { header: 'Nom', key: 'lastName' },
    { header: 'Prénom', key: 'firstName' },
    { header: 'Email', key: 'email' },
    { header: 'Chantier', key: 'siteName' },
    { header: 'Date', key: 'date' },
    { header: 'Heure entrée', key: 'arrivalTime' },
    { header: 'Heure sortie', key: 'departureTime' },
    { header: 'Durée réelle (h)', key: 'realDurationHours' },
    { header: 'Durée pauses (h)', key: 'pauseDurationHours' },
    { header: 'Distance (m)', key: 'distanceMeters' },
    { header: 'Statut', key: 'status' },
  ];

  worksheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    worksheet.addRow(row);
  }

  worksheet.columns.forEach((column) => {
    let maxLength = column.header ? String(column.header).length : 10;

    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const value = cell.text ?? '';
      maxLength = Math.max(maxLength, value.length);
    });

    column.width = maxLength + 2;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function monthRangeStart(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

function monthRangeEnd(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}

function parseMonth(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? parsed : null;
}

function parseYear(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : null;
}

function parseExportFormat(value: unknown) {
  return value === 'csv' || value === 'xlsx' ? value : null;
}

function parseCsvList(value: string | null) {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function sanitizeString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeDateTimeString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function escapeCsvValue(value: string) {
  const normalized = value.replaceAll('"', '""');
  return `"${normalized}"`;
}

function buildRhExportStorageKey(fileName: string) {
  const datePrefix = new Date().toISOString().slice(0, 10);
  const safeFileName = fileName.replace(/[^\w.-]+/g, '_');
  return `rh-exports/${datePrefix}/${Date.now()}_${safeFileName}`;
}

function formatHours(value: number) {
  return value.toFixed(2);
}

function roundHours(value: number) {
  return Number(value.toFixed(2));
}

function comparePresenceSummary(left: RhPresenceSummaryItem, right: RhPresenceSummaryItem) {
  return (
    left.lastName.localeCompare(right.lastName) ||
    left.firstName.localeCompare(right.firstName) ||
    left.userId.localeCompare(right.userId)
  );
}

function compareBuiltSession(left: BuiltSession, right: BuiltSession) {
  return (
    left.lastName.localeCompare(right.lastName) ||
    left.firstName.localeCompare(right.firstName) ||
    left.startedAt.localeCompare(right.startedAt) ||
    left.siteId.localeCompare(right.siteId)
  );
}

function matchesRhSearch(session: BuiltSession, search: string) {
  const normalized = search.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return `${session.firstName} ${session.lastName} ${session.email} ${session.siteName} ${session.role}`
    .toLowerCase()
    .includes(normalized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseRole(value: string | null) {
  if (!value) return null;
  return Object.values(Role).includes(value as Role) ? (value as Role) : null;
}

function parseLiveStatus(value: string | null): RhSitePresenceLiveStatus | null {
  const statuses: RhSitePresenceLiveStatus[] = ['PRESENT', 'PAUSED', 'EXPECTED_NOT_CLOCKED', 'LEFT', 'ANOMALY'];
  return statuses.includes(value as RhSitePresenceLiveStatus) ? (value as RhSitePresenceLiveStatus) : null;
}

function toDateOnlyDate(value: Date) {
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function liveResourceKey(siteId: string, userId: string) {
  return `${siteId}:${userId}`;
}

function buildLiveResource(
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: Role;
  },
  taskAction: string | null,
  records: {
    type: ClockInType;
    timestampLocal: Date;
    distanceToSite: Prisma.Decimal;
    isRemoteCheckout: boolean;
    isAutoClosed: boolean;
    isRegularized: boolean;
  }[],
): RhSitePresenceLiveResource {
  const latest = records.at(-1) ?? null;
  const arrival = [...records].reverse().find((record) => record.type === ClockInType.ARRIVAL) ?? null;
  const hasRemoteReview = records.some((record, index) => {
    if (!record.isRemoteCheckout || record.type !== ClockInType.DEPARTURE) return false;
    const previousArrival = records
      .slice(0, index)
      .reverse()
      .find((candidate) => candidate.type === ClockInType.ARRIVAL);
    return previousArrival ? record.timestampLocal.getTime() - previousArrival.timestampLocal.getTime() > 6 * 60 * 60 * 1000 : false;
  });
  const hasAnomaly = records.some((record) => record.isAutoClosed) || hasRemoteReview;
  const status = hasAnomaly ? 'ANOMALY' : getLiveStatusFromLatestRecord(latest);

  return {
    userId: user.id,
    name: `${user.firstName} ${user.lastName}`,
    email: user.email,
    role: user.role,
    status,
    taskAction,
    arrivalAt: arrival?.timestampLocal.toISOString() ?? null,
    lastClockInAt: latest?.timestampLocal.toISOString() ?? null,
    lastClockInType: latest?.type ?? null,
    distanceKm: latest?.distanceToSite.toNumber() ?? null,
    isRemoteCheckout: records.some((record) => record.isRemoteCheckout),
    isAutoClosed: records.some((record) => record.isAutoClosed),
    isRegularized: records.some((record) => record.isRegularized),
  };
}

function getLiveStatusFromLatestRecord(
  record: { type: ClockInType } | null,
): RhSitePresenceLiveStatus {
  if (!record) return 'EXPECTED_NOT_CLOCKED';
  if (record.type === ClockInType.PAUSE_START) return 'PAUSED';
  if (record.type === ClockInType.DEPARTURE) return 'LEFT';
  return 'PRESENT';
}

function matchesLiveResourceFilters(resource: RhSitePresenceLiveResource, query: SitePresenceLiveQuery) {
  if (query.status && resource.status !== query.status) return false;
  if (query.anomaliesOnly && resource.status !== 'ANOMALY') return false;

  if (query.search) {
    const normalized = query.search.toLowerCase();
    return `${resource.name} ${resource.email} ${resource.role} ${resource.taskAction ?? ''}`
      .toLowerCase()
      .includes(normalized);
  }

  return true;
}

function compareLiveResource(left: RhSitePresenceLiveResource, right: RhSitePresenceLiveResource) {
  return liveStatusRank(left.status) - liveStatusRank(right.status) || left.name.localeCompare(right.name);
}

function liveStatusRank(status: RhSitePresenceLiveStatus) {
  const ranks: Record<RhSitePresenceLiveStatus, number> = {
    ANOMALY: 0,
    PRESENT: 1,
    PAUSED: 2,
    EXPECTED_NOT_CLOCKED: 3,
    LEFT: 4,
  };

  return ranks[status];
}

function uniqueOption<T extends { id: string }>(option: T, index: number, options: T[]) {
  return options.findIndex((item) => item.id === option.id) === index;
}
