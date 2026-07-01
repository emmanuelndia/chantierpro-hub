import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import { ClockInStatus, ClockInType, OfficeClockInLocation, Prisma, Role, type PrismaClient } from '@prisma/client';
import { createSignedStorageUrl, uploadPrivateStorageObject } from '@/lib/storage';
import { projectAccessWhere } from '@/lib/projects';
import { generalSupervisorPlanningSiteWhere } from '@/lib/general-supervisor-scopes';
import { getBusinessManagedResourceRoles, isBusinessManagerRole } from '@/lib/field-roles';
import { formatRoleLabel } from '@/lib/role-labels';
import type {
  RhApiErrorCode,
  RhDirectionAttendanceReportResponse,
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
const SITE_PRESENCE_LIVE_ALLOWED_ROLES: readonly Role[] = [
  Role.HR,
  Role.DIRECTION,
  Role.ADMIN,
  Role.PROJECT_MANAGER,
  Role.GENERAL_SUPERVISOR,
  Role.BE_MANAGER,
  Role.NEGOTIATION_MANAGER,
  Role.FLEET_MANAGER,
];
const RH_EXPORT_HISTORY_LIMIT = 20;
const RH_EXPORT_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;

const rhClockInRecordSelect = {
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
  distanceToSite: true,
  comment: true,
  isRemoteCheckout: true,
  isAutoClosed: true,
  isRegularized: true,
  isLate: true,
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
      address: true,
      projectId: true,
      project: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  freeMission: {
    select: {
      id: true,
      action: true,
      projectId: true,
      project: {
        select: {
          id: true,
          name: true,
        },
      },
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
  email: string | null;
  matricule: string | null;
  role: Role;
  context: 'SITE' | 'FREE_MISSION' | 'OFFICE';
  siteId: string | null;
  position: string;
  projectId: string | null;
  projectName: string | null;
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
  isLate: boolean;
  startedAt: string;
  endedAt: string | null;
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
  format: 'csv' | 'xlsx' | 'pdf';
  from: string;
  to: string;
  userId: string | null;
  projectId: string | null;
  siteIds: string[];
  context: 'TERRAIN' | 'OFFICE' | null;
  lateOnly: boolean;
  attendanceList: boolean;
};

type SitePresenceLiveQuery = {
  date: Date;
  context: 'TERRAIN' | 'OFFICE' | null;
  projectId: string | null;
  projectManagerId: string | null;
  siteId: string | null;
  resourceId: string | null;
  assignedById: string | null;
  role: Role | null;
  status: RhSitePresenceLiveStatus | null;
  lateOnly: boolean;
  arrivalFromMinutes: number | null;
  arrivalToMinutes: number | null;
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
  userId: string;
  matricule: string;
  lastName: string;
  firstName: string;
  position: string;
  context: string;
  projectName: string;
  date: string;
  arrivalTime: string;
  departureTime: string;
  realDurationHours: string;
  timeSpent: string;
  isLate: string;
  status: string;
  detailPositions: string;
};

type PeriodSummaryRow = {
  userId: string;
  matricule: string;
  lastName: string;
  firstName: string;
  role: string;
  totalHours: string;
  timeSpent: string;
  reviewHours: string;
  presentDays: number;
  lateDays: number;
  anomalyDays: number;
  firstDate: string;
  lastDate: string;
  projects: string;
  positions: string;
  status: string;
};

type ExportAnomalyRow = ExportRow & {
  reason: string;
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

export function canAccessSitePresencesLive(role: Role) {
  return SITE_PRESENCE_LIVE_ALLOWED_ROLES.includes(role);
}

export function canAccessDirectionAttendanceReport(role: Role) {
  return RH_ALLOWED_ROLES.includes(role);
}

export async function getDirectionAttendanceReport(
  prisma: PrismaClient,
  date: Date,
  roles: Role[] = [],
): Promise<RhDirectionAttendanceReportResponse> {
  const day = toDateOnlyDate(date);
  const tomorrow = new Date(day);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const reportRoles = roles.filter((role) => role !== Role.DIRECTION);
  const activeUserWhere: Prisma.UserWhereInput = {
    isActive: true,
    role: reportRoles.length > 0 ? { in: reportRoles } : { not: Role.DIRECTION },
  };

  const [users, clockInBounds, todayRecords, negotiationBounds, todayNegotiationSessions] = await Promise.all([
    prisma.user.findMany({
      where: activeUserWhere,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        matricule: true,
        role: true,
        createdAt: true,
      },
    }),
    prisma.clockInRecord.groupBy({
      by: ['userId'],
      where: { status: ClockInStatus.VALID, user: activeUserWhere },
      _min: { timestampLocal: true },
      _max: { timestampLocal: true },
    }),
    prisma.clockInRecord.findMany({
      where: {
        status: ClockInStatus.VALID,
        timestampLocal: { gte: day, lt: tomorrow },
        user: activeUserWhere,
        type: { in: [ClockInType.ARRIVAL, ClockInType.DEPARTURE, ClockInType.PAUSE_START, ClockInType.PAUSE_END] },
      },
      orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: { userId: true, type: true, timestampLocal: true, isLate: true },
    }),
    prisma.negotiationSession.groupBy({
      by: ['userId'],
      where: { user: activeUserWhere },
      _min: { startTime: true },
      _max: { startTime: true, endTime: true },
    }),
    prisma.negotiationSession.findMany({
      where: {
        user: activeUserWhere,
        OR: [
          { startTime: { gte: day, lt: tomorrow } },
          { endTime: { gte: day, lt: tomorrow } },
        ],
      },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      select: { userId: true, startTime: true, endTime: true },
    }),
  ]);

  const clockBoundsByUser = new Map(clockInBounds.map((item) => [item.userId, item]));
  const negotiationBoundsByUser = new Map(negotiationBounds.map((item) => [item.userId, item]));
  const todayRecordsByUser = new Map<string, typeof todayRecords>();
  for (const record of todayRecords) {
    todayRecordsByUser.set(record.userId, [...(todayRecordsByUser.get(record.userId) ?? []), record]);
  }
  const todayNegotiationByUser = new Map<string, typeof todayNegotiationSessions>();
  for (const session of todayNegotiationSessions) {
    todayNegotiationByUser.set(session.userId, [...(todayNegotiationByUser.get(session.userId) ?? []), session]);
  }

  const reportUsers = users.map((user) => {
    const records = todayRecordsByUser.get(user.id) ?? [];
    const negotiationSessions = todayNegotiationByUser.get(user.id) ?? [];
    const clockBounds = clockBoundsByUser.get(user.id);
    const negotiationBounds = negotiationBoundsByUser.get(user.id);
    const hasArrivalToday = records.some((record) => record.type === ClockInType.ARRIVAL);
    const hasDepartureToday = records.some((record) => record.type === ClockInType.DEPARTURE);
    const hasNegotiationStartToday = negotiationSessions.some((session) => isDateInRange(session.startTime, day, tomorrow));
    const hasNegotiationEndToday = negotiationSessions.some((session) => Boolean(session.endTime && isDateInRange(session.endTime, day, tomorrow)));
    const hasClockedToday = hasArrivalToday || hasNegotiationStartToday;
    const firstClockInAt = minIsoDate([clockBounds?._min.timestampLocal ?? null, negotiationBounds?._min.startTime ?? null]);
    const lastClockInAt = maxIsoDate([
      clockBounds?._max.timestampLocal ?? null,
      negotiationBounds?._max.startTime ?? null,
      negotiationBounds?._max.endTime ?? null,
    ]);
    const todayArrivalAt = minIsoDate([
      ...records.filter((record) => record.type === ClockInType.ARRIVAL).map((record) => record.timestampLocal),
      ...negotiationSessions.filter((session) => isDateInRange(session.startTime, day, tomorrow)).map((session) => session.startTime),
    ]);
    const todayDepartureAt = maxIsoDate([
      ...records.filter((record) => record.type === ClockInType.DEPARTURE).map((record) => record.timestampLocal),
      ...negotiationSessions.map((session) => session.endTime).filter((value): value is Date => Boolean(value && isDateInRange(value, day, tomorrow))),
    ]);
    const neverClocked = !firstClockInAt;

    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      matricule: user.matricule,
      role: user.role,
      createdAt: user.createdAt.toISOString(),
      lastClockInAt,
      firstClockInAt,
      todayArrivalAt,
      todayDepartureAt,
      todayClockInCount: records.length + negotiationSessions.length,
      status: hasClockedToday ? ('CLOCKED_TODAY' as const) : neverClocked ? ('NEVER_CLOCKED' as const) : ('NOT_CLOCKED_TODAY' as const),
      hasDepartureToday: hasDepartureToday || hasNegotiationEndToday,
      isLateToday: records.some((record) => record.type === ClockInType.ARRIVAL && record.isLate) || Boolean(todayArrivalAt && isLateArrival(new Date(todayArrivalAt))),
      isOpenToday: hasClockedToday && !(hasDepartureToday || hasNegotiationEndToday),
      isDepartureOnlyToday: !hasClockedToday && (hasDepartureToday || hasNegotiationEndToday),
    };
  });

  const clockedToday = reportUsers.filter((user) => user.status === 'CLOCKED_TODAY');
  const notClockedToday = reportUsers.filter((user) => user.status !== 'CLOCKED_TODAY');
  const neverClocked = reportUsers.filter((user) => user.status === 'NEVER_CLOCKED');
  const departureOnlyToday = reportUsers.filter((user) => user.isDepartureOnlyToday);

  return {
    generatedAt: new Date().toISOString(),
    date: day.toISOString().slice(0, 10),
    summary: {
      activeUsers: reportUsers.length,
      clockedToday: clockedToday.length,
      notClockedToday: notClockedToday.length,
      neverClocked: neverClocked.length,
      leftToday: reportUsers.filter((user) => user.hasDepartureToday).length,
      openSessions: reportUsers.filter((user) => user.isOpenToday).length,
      lateToday: reportUsers.filter((user) => user.isLateToday).length,
      departureOnlyToday: departureOnlyToday.length,
    },
    users: {
      clockedToday: clockedToday.map(toDirectionAttendanceUser),
      notClockedToday: notClockedToday.map(toDirectionAttendanceUser),
      neverClocked: neverClocked.map(toDirectionAttendanceUser),
      departureOnlyToday: departureOnlyToday.map(toDirectionAttendanceUser),
    },
  };
}

export type DirectionAttendanceExportScope = 'all' | 'clocked-today' | 'not-clocked-today' | 'never-clocked' | 'departure-only';

export async function buildDirectionAttendanceReportExport(
  prisma: PrismaClient,
  date: Date,
  format: 'xlsx' | 'pdf',
  scope: DirectionAttendanceExportScope = 'all',
  roles: Role[] = [],
) {
  const report = await getDirectionAttendanceReport(prisma, date, roles);
  const scopeSuffix = scope === 'all' ? '' : `-${scope}`;
  const roleSuffix = roles.length > 0 ? `-${roles.map((role) => role.toLowerCase()).join('-')}` : '';
  const fileBaseName = `rapport-direction-pointage-${report.date}${scopeSuffix}${roleSuffix}`;

  if (format === 'xlsx') {
    return {
      buffer: await buildDirectionAttendanceXlsxBuffer(report, scope),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileName: `${fileBaseName}.xlsx`,
    };
  }

  return {
    buffer: buildDirectionAttendancePdfBuffer(report, scope),
    contentType: 'application/pdf',
    fileName: `${fileBaseName}.pdf`,
  };
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
    context: parsePresenceContext(typeof body.context === 'string' ? body.context : null),
    lateOnly: body.lateOnly === true,
    attendanceList: body.attendanceList === true,
  };
}

export function parseSitePresenceLiveQuery(searchParams: URLSearchParams): SitePresenceLiveQuery {
  const parsedDate = parseDateOnly(searchParams.get('date'));

  return {
    date: parsedDate ?? toDateOnlyDate(new Date()),
    context: parsePresenceContext(searchParams.get('context')),
    projectId: sanitizeString(searchParams.get('projectId')),
    projectManagerId: sanitizeString(searchParams.get('projectManagerId')),
    siteId: sanitizeString(searchParams.get('siteId')),
    resourceId: sanitizeString(searchParams.get('resourceId')),
    assignedById: sanitizeString(searchParams.get('assignedById')),
    role: parseRole(searchParams.get('role')),
    status: parseLiveStatus(searchParams.get('status')),
    lateOnly: searchParams.get('lateOnly') === 'true',
    arrivalFromMinutes: parseTimeOfDayMinutes(searchParams.get('arrivalFrom')),
    arrivalToMinutes: parseTimeOfDayMinutes(searchParams.get('arrivalTo')),
    search: sanitizeString(searchParams.get('q')),
    anomaliesOnly: searchParams.get('anomaliesOnly') === 'true',
  };
}

export async function getSitePresencesLive(
  prisma: PrismaClient,
  query: SitePresenceLiveQuery,
  user: AuthLikeUser,
): Promise<RhSitePresenceLiveResponse> {
  const today = query.date;
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const includeTerrain = query.context !== 'OFFICE';
  const includeOffice =
    query.context !== 'TERRAIN' &&
    !query.projectId &&
    !query.siteId &&
    !query.assignedById;
  const managedResourceRoles = isBusinessManagerRole(user.role)
    ? [...getBusinessManagedResourceRoles(user.role)]
    : null;

  const siteWhere: Prisma.SiteWhereInput = user.role === Role.GENERAL_SUPERVISOR
    ? {
        ...generalSupervisorPlanningSiteWhere(user, today),
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.siteId ? { id: query.siteId } : {}),
        ...(query.projectManagerId ? { project: { ...projectAccessWhere(user), projectManagerId: query.projectManagerId } } : {}),
      }
    : {
        status: 'ACTIVE',
        project: {
          ...projectAccessWhere(user),
          ...(query.projectManagerId ? { projectManagerId: query.projectManagerId } : {}),
        },
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.siteId ? { id: query.siteId } : {}),
      };

  const [sites, assignments, records, freeMissions, officeRecords, negotiationAssignments, negotiationSessions, teamAssignments, fleetManagerAssignments, fleetManagerFreeMissions, activeFleetManagers] = await Promise.all([
    includeTerrain ? prisma.site.findMany({
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
            projectManagerId: true,
            projectManager: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    }) : Promise.resolve([]),
    includeTerrain ? prisma.planningAssignment.findMany({
      where: {
        date: today,
        deletedAt: null,
        workLocationType: 'ON_SITE',
        site: siteWhere,
        ...(query.resourceId ? { supervisorId: query.resourceId } : {}),
        ...(query.assignedById ? { createdById: query.assignedById } : {}),
        supervisor: {
          isActive: true,
          ...(query.role || managedResourceRoles ? { role: query.role ?? { in: managedResourceRoles ?? [] } } : {}),
        },
      },
      orderBy: [{ site: { project: { name: 'asc' } } }, { site: { name: 'asc' } }, { supervisor: { firstName: 'asc' } }],
      select: {
        id: true,
        siteId: true,
        action: true,
        supervisorId: true,
        createdById: true,
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
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
    }) : Promise.resolve([]),
    includeTerrain ? prisma.clockInRecord.findMany({
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
        user: {
          isActive: true,
          ...(query.role || managedResourceRoles ? { role: query.role ?? { in: managedResourceRoles ?? [] } } : {}),
        },
      },
      orderBy: [{ site: { project: { name: 'asc' } } }, { site: { name: 'asc' } }, { user: { firstName: 'asc' } }, { timestampLocal: 'asc' }],
      select: {
        id: true,
        userId: true,
        siteId: true,
        type: true,
        timestampLocal: true,
        distanceToSite: true,
        latitude: true,
        longitude: true,
        accuracy: true,
        isRemoteCheckout: true,
        isAutoClosed: true,
        isRegularized: true,
        isLate: true,
        comment: true,
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
    }) : Promise.resolve([]),
    includeTerrain ? prisma.freeMission.findMany({
      where: {
        OR: [
          { date: today },
          {
            clockInRecords: {
              some: {
                status: ClockInStatus.VALID,
                timestampLocal: {
                  gte: today,
                  lt: tomorrow,
                },
              },
            },
          },
        ],
        deletedAt: null,
        project: projectAccessWhere(user),
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.projectManagerId ? { project: { ...projectAccessWhere(user), projectManagerId: query.projectManagerId } } : {}),
        ...(query.resourceId ? { assigneeId: query.resourceId } : {}),
        ...(query.assignedById ? { createdById: query.assignedById } : {}),
        assignee: {
          isActive: true,
          ...(query.role || managedResourceRoles ? { role: query.role ?? { in: managedResourceRoles ?? [] } } : {}),
        },
      },
      orderBy: [{ project: { name: 'asc' } }, { action: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        action: true,
        projectId: true,
        project: {
          select: {
            name: true,
            projectManagerId: true,
            projectManager: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        createdById: true,
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        assigneeId: true,
        assignee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
        clockInRecords: {
          where: {
            status: ClockInStatus.VALID,
            timestampLocal: {
              gte: today,
              lt: tomorrow,
            },
            type: {
              in: [ClockInType.ARRIVAL, ClockInType.DEPARTURE, ClockInType.PAUSE_START, ClockInType.PAUSE_END],
            },
          },
          orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            userId: true,
            siteId: true,
            type: true,
            timestampLocal: true,
            distanceToSite: true,
            latitude: true,
            longitude: true,
            accuracy: true,
            isRemoteCheckout: true,
            isAutoClosed: true,
            isRegularized: true,
            isLate: true,
            comment: true,
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
        },
      },
    }) : Promise.resolve([]),
    includeOffice ? prisma.clockInRecord.findMany({
      where: {
        status: ClockInStatus.VALID,
        officeClockInLocation: { not: null },
        timestampLocal: {
          gte: today,
          lt: tomorrow,
        },
        type: {
          in: [ClockInType.ARRIVAL, ClockInType.DEPARTURE, ClockInType.PAUSE_START, ClockInType.PAUSE_END],
        },
        ...(query.resourceId ? { userId: query.resourceId } : {}),
        user: {
          isActive: true,
          ...(query.role ? { role: query.role } : {}),
          ...(query.projectManagerId ? { role: Role.FLEET_RESOURCE } : {}),
        },
      },
      orderBy: [{ officeLocation: { name: 'asc' } }, { user: { firstName: 'asc' } }, { timestampLocal: 'asc' }],
      select: {
        id: true,
        userId: true,
        officeLocationId: true,
        officeClockInLocation: true,
        type: true,
        timestampLocal: true,
        distanceToSite: true,
        latitude: true,
        longitude: true,
        accuracy: true,
        isRemoteCheckout: true,
        isAutoClosed: true,
        isRegularized: true,
        isLate: true,
        comment: true,
        planningAssignment: {
          select: {
            id: true,
            action: true,
            workLocationType: true,
            createdById: true,
            createdBy: { select: { id: true, firstName: true, lastName: true, role: true } },
          },
        },
        officeLocation: {
          select: {
            id: true,
            name: true,
            address: true,
          },
        },
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
    }) : Promise.resolve([]),
    includeTerrain ? prisma.negotiationAssignment.findMany({
      where: {
        date: today,
        deletedAt: null,
        project: {
          ...projectAccessWhere(user),
          ...(query.projectManagerId ? { projectManagerId: query.projectManagerId } : {}),
        },
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.resourceId ? { assigneeId: query.resourceId } : {}),
        ...(query.assignedById ? { createdById: query.assignedById } : {}),
        assignee: {
          isActive: true,
          ...(query.role || managedResourceRoles ? { role: query.role ?? { in: managedResourceRoles ?? [] } } : {}),
        },
      },
      orderBy: [{ project: { name: 'asc' } }, { plannedZone: 'asc' }, { assignee: { firstName: 'asc' } }],
      select: {
        id: true,
        projectId: true,
        plannedZone: true,
        instruction: true,
        createdById: true,
        project: {
          select: {
            name: true,
            projectManagerId: true,
            projectManager: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        assigneeId: true,
        assignee: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
      },
    }) : Promise.resolve([]),
    includeTerrain ? prisma.negotiationSession.findMany({
      where: {
        date: today,
        project: {
          ...projectAccessWhere(user),
          ...(query.projectManagerId ? { projectManagerId: query.projectManagerId } : {}),
        },
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.resourceId ? { userId: query.resourceId } : {}),
        user: {
          isActive: true,
          ...(query.role || managedResourceRoles ? { role: query.role ?? { in: managedResourceRoles ?? [] } } : {}),
        },
      },
      orderBy: [{ project: { name: 'asc' } }, { user: { firstName: 'asc' } }, { startTime: 'asc' }],
      select: {
        id: true,
        assignmentId: true,
        projectId: true,
        userId: true,
        startTime: true,
        startLatitude: true,
        startLongitude: true,
        startAccuracy: true,
        endTime: true,
        endLatitude: true,
        endLongitude: true,
        endAccuracy: true,
        status: true,
        project: {
          select: {
            name: true,
            projectManagerId: true,
            projectManager: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        assignment: { select: { id: true, plannedZone: true, instruction: true, createdById: true, createdBy: { select: { id: true, firstName: true, lastName: true } } } },
        user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
      },
    }) : Promise.resolve([]),
    includeTerrain ? prisma.teamAssignment.findMany({
      where: {
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
        site: siteWhere,
        ...(query.siteId ? { siteId: query.siteId } : {}),
      },
      select: {
        siteId: true,
        supervisor: { select: { id: true, firstName: true, lastName: true } },
        team: {
          select: {
            name: true,
            members: {
              where: {
                status: 'ACTIVE',
                assignmentDate: { lte: today },
                OR: [{ endDate: null }, { endDate: { gte: today } }],
                ...(query.resourceId ? { userId: query.resourceId } : {}),
                user: {
          isActive: true,
          ...(query.role || managedResourceRoles ? { role: query.role ?? { in: managedResourceRoles ?? [] } } : {}),
        },
              },
              select: { userId: true },
            },
          },
        },
      },
    }) : Promise.resolve([]),
    includeOffice ? prisma.planningAssignment.findMany({
      where: {
        date: today,
        deletedAt: null,
        supervisor: { isActive: true, role: Role.FLEET_RESOURCE },
        createdBy: { isActive: true, role: Role.FLEET_MANAGER },
        ...(query.projectManagerId ? { createdById: query.projectManagerId } : {}),
        ...(query.resourceId ? { supervisorId: query.resourceId } : {}),
      },
      select: {
        supervisorId: true,
        createdById: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    }) : Promise.resolve([]),
    includeOffice ? prisma.freeMission.findMany({
      where: {
        date: today,
        deletedAt: null,
        assignee: { isActive: true, role: Role.FLEET_RESOURCE },
        createdBy: { isActive: true, role: Role.FLEET_MANAGER },
        ...(query.projectManagerId ? { createdById: query.projectManagerId } : {}),
        ...(query.resourceId ? { assigneeId: query.resourceId } : {}),
      },
      select: {
        assigneeId: true,
        createdById: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    }) : Promise.resolve([]),
    includeOffice ? prisma.user.findMany({
      where: { isActive: true, role: Role.FLEET_MANAGER },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      select: { id: true, firstName: true, lastName: true },
    }) : Promise.resolve([]),
  ]);

  type LivePresenceRow = RhSitePresenceLiveResponse['sites'][number] & {
    projectManagerId: string;
    projectManagerName: string;
  };
  const siteRows = new Map<string, LivePresenceRow>(
    sites.map((site) => [
      site.id,
      {
        siteId: site.id,
        siteName: site.name,
        siteAddress: site.address,
        presenceContext: 'TERRAIN' as const,
        projectId: site.projectId,
        projectName: site.project.name,
        projectManagerId: site.project.projectManagerId,
        projectManagerName: formatPersonName(site.project.projectManager),
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
  for (const mission of freeMissions) {
    siteRows.set(mission.id, {
      siteId: mission.id,
      siteName: mission.action,
      siteAddress: 'Mission libre',
      presenceContext: 'TERRAIN',
      projectId: mission.projectId,
      projectName: mission.project.name,
      projectManagerId: mission.project.projectManagerId,
      projectManagerName: formatPersonName(mission.project.projectManager),
      expectedCount: 0,
      presentCount: 0,
      pausedCount: 0,
      notClockedCount: 0,
      leftCount: 0,
      anomalyCount: 0,
      lastActivityAt: null as string | null,
      resources: [] as RhSitePresenceLiveResource[],
    });
  }
  for (const assignment of negotiationAssignments) {
    const rowId = `negotiation:${assignment.id}`;
    siteRows.set(rowId, {
      siteId: rowId,
      siteName: assignment.plannedZone ? `Zone nego - ${assignment.plannedZone}` : 'Zone nego',
      siteAddress: 'Negociation',
      presenceContext: 'TERRAIN',
      projectId: assignment.projectId,
      projectName: assignment.project.name,
      projectManagerId: assignment.project.projectManagerId,
      projectManagerName: formatPersonName(assignment.project.projectManager),
      expectedCount: 0,
      presentCount: 0,
      pausedCount: 0,
      notClockedCount: 0,
      leftCount: 0,
      anomalyCount: 0,
      lastActivityAt: null as string | null,
      resources: [] as RhSitePresenceLiveResource[],
    });
  }
  for (const session of negotiationSessions) {
    const rowId = session.assignmentId ? `negotiation:${session.assignmentId}` : `negotiation-session:${session.id}`;
    if (!siteRows.has(rowId)) {
      siteRows.set(rowId, {
        siteId: rowId,
        siteName: session.assignment?.plannedZone ? `Zone nego - ${session.assignment.plannedZone}` : 'Zone nego',
        siteAddress: 'Negociation',
        presenceContext: 'TERRAIN',
        projectId: session.projectId,
        projectName: session.project.name,
        projectManagerId: session.project.projectManagerId,
        projectManagerName: formatPersonName(session.project.projectManager),
        expectedCount: 0,
        presentCount: 0,
        pausedCount: 0,
        notClockedCount: 0,
        leftCount: 0,
        anomalyCount: 0,
        lastActivityAt: null as string | null,
        resources: [] as RhSitePresenceLiveResource[],
      });
    }
  }
  for (const record of officeRecords) {
    const isProfessionalTravel = record.officeClockInLocation === OfficeClockInLocation.PROFESSIONAL_TRAVEL;
    const rowId = isProfessionalTravel ? 'office:professional-travel' : `office:${record.officeLocationId ?? 'default'}`;
    if (!siteRows.has(rowId)) {
      siteRows.set(rowId, {
        siteId: rowId,
        siteName: isProfessionalTravel ? 'Deplacement professionnel' : record.officeLocation?.name ?? 'Bureau',
        siteAddress: isProfessionalTravel ? 'Pointage en deplacement' : record.officeLocation?.address ?? 'Pointage bureau',
        presenceContext: 'OFFICE',
        projectId: '',
        projectName: isProfessionalTravel ? 'Deplacement professionnel' : 'Bureau',
        projectManagerId: '',
        projectManagerName: isProfessionalTravel ? 'Deplacement professionnel' : 'Bureau',
        expectedCount: 0,
        presentCount: 0,
        pausedCount: 0,
        notClockedCount: 0,
        leftCount: 0,
        anomalyCount: 0,
        lastActivityAt: null as string | null,
        resources: [] as RhSitePresenceLiveResource[],
      });
    }
  }

  type LiveRecordWithUser = Parameters<typeof buildLiveResource>[2][number] & {
    planningAssignment?: {
      action: string;
      workLocationType: string;
    } | null;
    user: {
      id: string;
      firstName: string;
      lastName: string;
      email: string | null;
      role: Role;
    };
  };
  const fleetManagersByResourceId = new Map<string, { id: string; label: string }[]>();
  const addFleetManagerForResource = (resourceId: string, manager: { id: string; firstName: string; lastName: string }) => {
    const managers = fleetManagersByResourceId.get(resourceId) ?? [];
    if (!managers.some((item) => item.id === manager.id)) {
      managers.push({ id: manager.id, label: formatPersonName(manager) });
    }
    fleetManagersByResourceId.set(resourceId, managers);
  };

  for (const assignment of fleetManagerAssignments) {
    addFleetManagerForResource(assignment.supervisorId, assignment.createdBy);
  }
  for (const mission of fleetManagerFreeMissions) {
    addFleetManagerForResource(mission.assigneeId, mission.createdBy);
  }
  const singleActiveFleetManager = activeFleetManagers.length === 1 ? activeFleetManagers[0] : null;
  for (const record of officeRecords) {
    if (record.user.role !== Role.FLEET_RESOURCE) continue;
    if (record.planningAssignment?.createdBy.role === Role.FLEET_MANAGER) {
      addFleetManagerForResource(record.userId, record.planningAssignment.createdBy);
    } else if (singleActiveFleetManager) {
      addFleetManagerForResource(record.userId, singleActiveFleetManager);
    }
  }

  const recordsBySiteUser = new Map<string, LiveRecordWithUser[]>();
  for (const record of records) {
    if (!record.siteId) {
      continue;
    }
    const key = liveResourceKey(record.siteId, record.userId);
    recordsBySiteUser.set(key, [...(recordsBySiteUser.get(key) ?? []), record]);
  }
  for (const mission of freeMissions) {
    const key = liveResourceKey(mission.id, mission.assigneeId);
    recordsBySiteUser.set(key, [...(recordsBySiteUser.get(key) ?? []), ...mission.clockInRecords]);
  }
  for (const record of officeRecords) {
    const rowId =
      record.officeClockInLocation === OfficeClockInLocation.PROFESSIONAL_TRAVEL
        ? 'office:professional-travel'
        : `office:${record.officeLocationId ?? 'default'}`;
    const key = liveResourceKey(rowId, record.userId);
    recordsBySiteUser.set(key, [...(recordsBySiteUser.get(key) ?? []), record]);
  }
  for (const session of negotiationSessions) {
    const rowId = session.assignmentId ? `negotiation:${session.assignmentId}` : `negotiation-session:${session.id}`;
    const sessionRecords: LiveRecordWithUser[] = [
      {
        type: ClockInType.ARRIVAL,
        timestampLocal: session.startTime,
        distanceToSite: new Prisma.Decimal(0),
        latitude: session.startLatitude,
        longitude: session.startLongitude,
        accuracy: session.startAccuracy,
        isRemoteCheckout: false,
        isAutoClosed: false,
        isRegularized: false,
        isLate: isLateArrival(session.startTime),
        user: session.user,
      },
    ];
    if (session.endTime) {
      sessionRecords.push({
        type: ClockInType.DEPARTURE,
        timestampLocal: session.endTime,
        distanceToSite: new Prisma.Decimal(0),
        latitude: session.endLatitude,
        longitude: session.endLongitude,
        accuracy: session.endAccuracy,
        isRemoteCheckout: false,
        isAutoClosed: false,
        isRegularized: false,
        isLate: false,
        user: session.user,
      });
    }
    const key = liveResourceKey(rowId, session.userId);
    recordsBySiteUser.set(key, [...(recordsBySiteUser.get(key) ?? []), ...sessionRecords]);
  }

  const assignmentBySiteUser = new Map<
    string,
    {
      action: string;
      supervisorId: string;
      supervisor: (typeof assignments)[number]['supervisor'];
      createdById: string;
      createdBy: (typeof assignments)[number]['createdBy'];
    }
  >();
  for (const assignment of assignments) {
    const key = liveResourceKey(assignment.siteId, assignment.supervisorId);
    const existing = assignmentBySiteUser.get(key);
    assignmentBySiteUser.set(key, existing ? { ...existing, action: `${existing.action} / ${assignment.action}` } : assignment);
  }
  for (const mission of freeMissions) {
    const key = liveResourceKey(mission.id, mission.assigneeId);
    const existing = assignmentBySiteUser.get(key);
    const assignment = {
      action: mission.action,
      supervisorId: mission.assigneeId,
      supervisor: mission.assignee,
      createdById: mission.createdById,
      createdBy: mission.createdBy,
    };
    assignmentBySiteUser.set(key, existing ? { ...existing, action: `${existing.action} / ${mission.action}` } : assignment);
  }
  for (const assignment of negotiationAssignments) {
    const rowId = `negotiation:${assignment.id}`;
    const key = liveResourceKey(rowId, assignment.assigneeId);
    const existing = assignmentBySiteUser.get(key);
    const instruction = assignment.instruction?.trim();
    let action = assignment.plannedZone ? `Negociation - ${assignment.plannedZone}` : 'Negociation';
    if (instruction) action = instruction;
    const nextAssignment = {
      action,
      supervisorId: assignment.assigneeId,
      supervisor: assignment.assignee,
      createdById: assignment.createdById,
      createdBy: assignment.createdBy,
    };
    assignmentBySiteUser.set(key, existing ? { ...existing, action: `${existing.action} / ${action}` } : nextAssignment);
  }


  const teamInfoBySiteUser = new Map<string, { teamName: string; teamSupervisorName: string }>();
  for (const teamAssignment of teamAssignments) {
    const teamSupervisorName = formatPersonName(teamAssignment.supervisor);
    for (const member of teamAssignment.team.members) {
      const key = liveResourceKey(teamAssignment.siteId, member.userId);
      const existing = teamInfoBySiteUser.get(key);
      teamInfoBySiteUser.set(key, {
        teamName: existing ? `${existing.teamName} / ${teamAssignment.team.name}` : teamAssignment.team.name,
        teamSupervisorName: existing ? `${existing.teamSupervisorName} / ${teamSupervisorName}` : teamSupervisorName,
      });
    }
  }
  const allKeys = new Set([...recordsBySiteUser.keys(), ...assignmentBySiteUser.keys()]);
  const resourcesById = new Map<string, { id: string; label: string; role: Role }>();
  const projectManagersById = new Map<string, { id: string; label: string }>();
  const assignersById = new Map<string, { id: string; label: string }>();
  const roles = new Set<Role>();
  const liveResourceEntries: {
    site: LivePresenceRow;
    resource: RhSitePresenceLiveResource;
    user: {
      id: string;
      firstName: string;
      lastName: string;
      email: string | null;
      role: Role;
    };
    assignment: {
      action: string;
      supervisorId: string;
      supervisor: (typeof assignments)[number]['supervisor'];
      createdById: string;
      createdBy: (typeof assignments)[number]['createdBy'];
    } | null;
  }[] = [];

  for (const key of allKeys) {
    const { siteId } = parseLiveResourceKey(key);
    const site = siteId ? siteRows.get(siteId) : null;
    if (!site) continue;

    const siteRecords = recordsBySiteUser.get(key) ?? [];
    const assignment = assignmentBySiteUser.get(key) ?? null;
    const user = assignment?.supervisor ?? siteRecords[0]?.user;
    if (!user) continue;

    const officeFleetManagers = site.presenceContext === 'OFFICE' ? (fleetManagersByResourceId.get(user.id) ?? []) : [];
    if (site.presenceContext === 'OFFICE' && query.projectManagerId && !officeFleetManagers.some((manager) => manager.id === query.projectManagerId)) {
      continue;
    }

    const officeTaskAction = site.presenceContext === 'OFFICE' ? getOfficeTaskAction(siteRecords) : null;
    const resource = buildLiveResource(user, assignment?.action ?? officeTaskAction, siteRecords, site.presenceContext, today);
    const teamInfo = site.siteId ? teamInfoBySiteUser.get(liveResourceKey(site.siteId, user.id)) : null;
    if (teamInfo) {
      resource.teamName = teamInfo.teamName;
      resource.teamSupervisorName = teamInfo.teamSupervisorName;
    }
    liveResourceEntries.push({ site, resource, user, assignment });
  }

  const usersWithPresenceInScope = new Set(
    liveResourceEntries
      .filter(({ resource }) => hasLivePresenceDuringSelectedDay(resource) || resource.status === 'ANOMALY')
      .map(({ resource }) => resource.userId),
  );

  for (const { site, resource, user, assignment } of liveResourceEntries) {
    if (!matchesLiveResourceFilters(resource, query, usersWithPresenceInScope)) continue;

    site.resources.push(resource);
    roles.add(user.role);
    resourcesById.set(user.id, {
      id: user.id,
      label: `${user.firstName} ${user.lastName}`,
      role: user.role,
    });

    if (assignment) site.expectedCount += 1;
    if (site.presenceContext === 'OFFICE') {
      for (const manager of fleetManagersByResourceId.get(user.id) ?? []) {
        projectManagersById.set(manager.id, manager);
      }
    } else if (site.projectManagerId) {
      projectManagersById.set(site.projectManagerId, {
        id: site.projectManagerId,
        label: site.projectManagerName,
      });
    }
    if (assignment) {
      assignersById.set(assignment.createdById, {
        id: assignment.createdById,
        label: formatPersonName(assignment.createdBy),
      });
    }
    if (hasLivePresenceDuringSelectedDay(resource)) site.presentCount += 1;
    if (resource.status === 'PAUSED') site.pausedCount += 1;
    if (resource.status === 'EXPECTED_NOT_CLOCKED') site.notClockedCount += 1;
    if (resource.status === 'LEFT') site.leftCount += 1;
    if (resource.status === 'ANOMALY' || resource.anomalyReason) site.anomalyCount += 1;

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
      lateResources: filteredSites.reduce((sum, site) => sum + site.resources.filter((resource) => resource.isLate).length, 0),
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
      projectManagers: [...projectManagersById.values()].sort((a, b) => a.label.localeCompare(b.label)),
      assigners: [...assignersById.values()].sort((a, b) => a.label.localeCompare(b.label)),
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
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt) || (left.siteId ?? '').localeCompare(right.siteId ?? ''))
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
    return { code: 'BAD_REQUEST' as const, reason: 'INVALID_PAYLOAD' as const, recordId: null };
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
    return { code: 'BAD_REQUEST' as const, reason: 'DEPARTURE_BEFORE_ARRIVAL' as const, recordId: null };
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
    const updated = await regularizeExistingDeparture(prisma, {
      arrivalId: arrival.id,
      departureId: existingDeparture.id,
      correctedDepartureTime,
      comment,
      authorId: payload.author.id,
    });

    return { code: null, recordId: updated.id };
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

async function regularizeExistingDeparture(
  prisma: PrismaClient,
  payload: {
    arrivalId: string;
    departureId: string;
    correctedDepartureTime: Date;
    comment: string;
    authorId: string;
  },
) {
  return prisma.$transaction(async (tx) => {
    const record = await tx.clockInRecord.update({
      where: { id: payload.departureId },
      data: {
        clockInDate: new Date(`${payload.correctedDepartureTime.toISOString().slice(0, 10)}T00:00:00.000Z`),
        clockInTime: payload.correctedDepartureTime,
        timestampLocal: payload.correctedDepartureTime,
        comment: payload.comment,
        isRegularized: true,
      },
      select: { id: true },
    });

    await tx.clockInRegularization.create({
      data: {
        clockInRecordId: record.id,
        correctedDepartureTime: payload.correctedDepartureTime,
        authorId: payload.authorId,
        comment: payload.comment,
      },
    });

    await tx.clockInRecord.update({
      where: { id: payload.arrivalId },
      data: { isRegularized: true },
      select: { id: true },
    });

    return record;
  });
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
    context: payload.input.context,
    lateOnly: payload.input.lateOnly,
  });

  const rows = sessions.map(buildExportRowFromSession).sort(compareExportRows);
  const exportRows = payload.input.attendanceList ? aggregateAttendanceRows(rows) : rows;
  const periodSummaryRows = payload.input.attendanceList ? [] : buildPeriodSummaryRows(sessions);
  const anomalyRows = payload.input.attendanceList ? [] : buildExportAnomalyRows(sessions);
  const fileBaseName = `rh-export-${payload.input.from.slice(0, 10)}-${payload.input.to.slice(0, 10)}`;
  const rowCount = payload.input.attendanceList ? exportRows.length : periodSummaryRows.length;

  if (payload.input.format === 'csv') {
    const buffer = payload.input.attendanceList ? buildAttendanceCsvBuffer(exportRows) : buildPeriodSummaryCsvBuffer(periodSummaryRows);
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
      rowCount,
      storageKey,
      expiresAt,
    };
  }

  if (payload.input.format === 'pdf') {
    const buffer = payload.input.attendanceList
      ? buildAttendancePdfBuffer(exportRows, {
          from: payload.input.from,
          to: payload.input.to,
        })
      : buildPeriodSummaryPdfBuffer(periodSummaryRows, {
          from: payload.input.from,
          to: payload.input.to,
        });
    const fileName = `${fileBaseName}.pdf`;
    const storageKey = buildRhExportStorageKey(fileName);
    const expiresAt = new Date(Date.now() + RH_EXPORT_ARTIFACT_TTL_MS).toISOString();

    await uploadPrivateStorageObject({
      storageKey,
      body: buffer,
      contentType: 'application/pdf',
    });

    return {
      contentType: 'application/pdf',
      fileName,
      buffer,
      rowCount,
      storageKey,
      expiresAt,
    };
  }

  const buffer = payload.input.attendanceList
    ? await buildAttendanceXlsxBuffer(exportRows)
    : await buildPeriodXlsxBuffer(periodSummaryRows, exportRows, anomalyRows);
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
    rowCount,
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
      format: payload.input.format === 'csv' ? 'CSV' : payload.input.format === 'pdf' ? 'PDF' : 'XLSX',
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

export async function getRhOptions(prisma: PrismaClient, user: AuthLikeUser): Promise<RhOptionsResponse> {
  const projectWhere = projectAccessWhere(user);
  const [projects, sites, resources] = await Promise.all([
    prisma.project.findMany({
      where: projectWhere,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
      },
    }),
    prisma.site.findMany({
      where: {
        project: projectWhere,
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
    context?: 'TERRAIN' | 'OFFICE' | null;
    lateOnly?: boolean;
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
            OR: [
              {
                site: {
                  projectId: payload.projectId,
                },
              },
              {
                freeMission: {
                  projectId: payload.projectId,
                },
              },
            ],
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

  return buildSessions(records).filter((session) => {
    if (payload.context === 'OFFICE' && session.context !== 'OFFICE') return false;
    if (payload.context === 'TERRAIN' && session.context === 'OFFICE') return false;
    if (payload.lateOnly && !session.isLate) return false;
    return true;
  });
}

function buildSessions(records: SerializableRhClockInRecord[]) {
  const sessions: BuiltSession[] = [];
  const states = new Map<string, SessionBuildState>();

  for (const record of records) {
    const key = buildClockInContextKey(record);
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

function buildClockInContextKey(record: SerializableRhClockInRecord) {
  if (record.siteId) {
    return `${record.userId}:site:${record.siteId}`;
  }

  if (record.freeMissionId) {
    return `${record.userId}:free-mission:${record.freeMissionId}`;
  }

  if (record.officeClockInLocation) {
    return `${record.userId}:office:${record.officeClockInLocation}`;
  }

  return `${record.userId}:unknown`;
}

function getPresenceContext(record: SerializableRhClockInRecord): {
  type: BuiltSession['context'];
  position: string;
  projectId: string | null;
  projectName: string | null;
} {
  if (record.site) {
    const siteAddress = record.site.address?.trim();
    return {
      type: 'SITE',
      position: siteAddress || record.site.name,
      projectId: record.site.projectId,
      projectName: record.site.project.name,
    };
  }

  if (record.freeMission) {
    return {
      type: 'FREE_MISSION',
      position: record.freeMission.action,
      projectId: record.freeMission.projectId,
      projectName: record.freeMission.project.name,
    };
  }

  return {
    type: 'OFFICE',
    position:
      record.officeClockInLocation === OfficeClockInLocation.PROFESSIONAL_TRAVEL
        ? 'Deplacement professionnel'
        : record.officeLocation?.name ?? 'Bureau',
    projectId: null,
    projectName: null,
  };
}

function presenceContextLabel(context: BuiltSession['context']) {
  if (context === 'FREE_MISSION') {
    return 'Mission libre';
  }

  if (context === 'OFFICE') {
    return 'Bureau';
  }

  return 'Chantier';
}

function rhSessionStatusLabel(status: BuiltSession['status']) {
  switch (status) {
    case 'COMPLETE':
      return 'Complete';
    case 'INCOMPLETE_SESSION':
      return 'En cours';
    case 'TO_REGULARIZE':
      return 'A regulariser';
    case 'TO_REVIEW_RH':
      return 'A verifier RH';
  }
}

function formatDurationLabel(hours: number) {
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const hourPart = Math.floor(totalMinutes / 60);
  const minutePart = totalMinutes % 60;

  if (hourPart === 0) {
    return `${minutePart} min`;
  }

  return minutePart === 0 ? `${hourPart} h` : `${hourPart} h ${minutePart} min`;
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
  const context = getPresenceContext(arrival);

  return {
    arrivalRecordId: arrival.id,
    departureRecordId: departure.id,
    userId: arrival.userId,
    firstName: arrival.user.firstName,
    lastName: arrival.user.lastName,
    email: arrival.user.email,
    matricule: arrival.user.matricule,
    role: arrival.user.role,
    context: context.type,
    siteId: arrival.siteId,
    position: context.position,
    projectId: context.projectId,
    projectName: context.projectName,
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
    isLate: arrival.isLate,
    startedAt: arrival.timestampLocal.toISOString(),
    endedAt: departure.timestampLocal.toISOString(),
  };
}

function buildIncompleteSession(
  arrival: SerializableRhClockInRecord,
  accumulatedPauseMs: number,
): BuiltSession {
  const isPreviousDay = arrival.timestampLocal.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10);
  const context = getPresenceContext(arrival);

  return {
    arrivalRecordId: arrival.id,
    departureRecordId: null,
    userId: arrival.userId,
    firstName: arrival.user.firstName,
    lastName: arrival.user.lastName,
    email: arrival.user.email,
    matricule: arrival.user.matricule,
    role: arrival.user.role,
    context: context.type,
    siteId: arrival.siteId,
    position: context.position,
    projectId: context.projectId,
    projectName: context.projectName,
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
    isLate: arrival.isLate,
    startedAt: arrival.timestampLocal.toISOString(),
    endedAt: null,
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
    lastSite = session.position;
    if (session.siteId) {
      siteIds.add(session.siteId);
    }

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
    siteName: session.position,
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
    format: item.format === 'CSV' ? 'csv' : item.format === 'PDF' ? 'pdf' : 'xlsx',
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

function buildExportRowFromSession(session: BuiltSession): ExportRow {
  const context = presenceContextLabel(session.context);
  const status = rhSessionStatusLabel(session.status);

  return {
    userId: session.userId,
    matricule: session.matricule ?? '',
    lastName: session.lastName,
    firstName: session.firstName,
    position: session.position,
    context,
    projectName: session.projectName ?? '',
    date: session.date,
    arrivalTime: session.arrivalTime,
    departureTime: session.departureTime ?? '',
    realDurationHours: session.realDurationHours === null ? '' : formatHours(session.realDurationHours),
    timeSpent: session.realDurationHours === null ? '' : formatDurationLabel(session.realDurationHours),
    isLate: session.isLate ? 'Oui' : 'Non',
    status,
    detailPositions: buildAttendanceDetailPosition({
      position: session.position,
      context,
      arrivalTime: session.arrivalTime,
      departureTime: session.departureTime ?? '',
      status,
    }),
  };
}

function compareExportRows(left: ExportRow, right: ExportRow) {
  return (
    left.lastName.localeCompare(right.lastName) ||
    left.firstName.localeCompare(right.firstName) ||
    left.date.localeCompare(right.date) ||
    left.arrivalTime.localeCompare(right.arrivalTime) ||
    left.position.localeCompare(right.position)
  );
}

function buildPeriodSummaryRows(sessions: BuiltSession[]): PeriodSummaryRow[] {
  const grouped = new Map<string, BuiltSession[]>();

  for (const session of sessions) {
    grouped.set(session.userId, [...(grouped.get(session.userId) ?? []), session]);
  }

  return [...grouped.values()]
    .map((group) => buildPeriodSummaryRow(group))
    .sort((left, right) => left.lastName.localeCompare(right.lastName) || left.firstName.localeCompare(right.firstName));
}

function buildPeriodSummaryRow(group: BuiltSession[]): PeriodSummaryRow {
  const orderedSessions = [...group].sort(compareBuiltSession);
  const owner = orderedSessions[0]!;
  const reliableSessions = orderedSessions.filter((session) => getSessionAnomalyReasons(session).length === 0);
  const reviewSessions = orderedSessions.filter((session) => getSessionAnomalyReasons(session).length > 0);
  const totalHours = reliableSessions.reduce((sum, session) => sum + (session.realDurationHours ?? 0), 0);
  const reviewHours = reviewSessions.reduce((sum, session) => sum + (session.realDurationHours ?? 0), 0);
  const presentDates = new Set(orderedSessions.map((session) => session.date));
  const lateDates = new Set(orderedSessions.filter((session) => session.isLate).map((session) => session.date));
  const anomalyDates = new Set(reviewSessions.map((session) => session.date));
  const projects = joinUnique(orderedSessions.map((session) => session.projectName ?? ''));
  const positions = joinUnique(orderedSessions.map((session) => session.position));
  const status = anomalyDates.size > 0 ? 'A verifier RH' : 'OK';

  return {
    userId: owner.userId,
    matricule: owner.matricule ?? '',
    lastName: owner.lastName,
    firstName: owner.firstName,
    role: formatRoleLabel(owner.role),
    totalHours: formatHours(totalHours),
    timeSpent: formatDurationLabel(totalHours),
    reviewHours: reviewHours > 0 ? formatHours(reviewHours) : '',
    presentDays: presentDates.size,
    lateDays: lateDates.size,
    anomalyDays: anomalyDates.size,
    firstDate: orderedSessions[0]?.date ?? '',
    lastDate: orderedSessions.at(-1)?.date ?? '',
    projects,
    positions,
    status,
  };
}

function buildExportAnomalyRows(sessions: BuiltSession[]): ExportAnomalyRow[] {
  return sessions
    .flatMap((session) => {
      const reason = getSessionAnomalyReasons(session).join(', ');
      return reason ? [{ ...buildExportRowFromSession(session), reason }] : [];
    })
    .sort((left, right) => left.lastName.localeCompare(right.lastName) || left.firstName.localeCompare(right.firstName) || left.date.localeCompare(right.date));
}

function getSessionAnomalyReasons(session: BuiltSession) {
  const reasons: string[] = [];

  if (session.status !== 'COMPLETE') {
    reasons.push(rhSessionStatusLabel(session.status));
  }

  if (!session.departureTime || !session.endedAt) {
    reasons.push('Sortie manquante');
  }

  if (session.realDurationHours !== null && session.realDurationHours > 16) {
    reasons.push('Duree superieure a 16h');
  }

  if (session.endedAt && session.startedAt.slice(0, 10) !== session.endedAt.slice(0, 10)) {
    reasons.push('Session multi-jours');
  }

  if (session.endedAt && new Date(session.endedAt).getTime() < new Date(session.startedAt).getTime()) {
    reasons.push('Sortie avant entree');
  }

  return [...new Set(reasons)];
}

function buildPeriodSummaryCsvBuffer(rows: PeriodSummaryRow[]) {
  const headers = [
    'Matricule',
    'Nom',
    'Prenom',
    'Role',
    'Total heures fiables',
    'Temps passe fiable',
    'Heures a verifier',
    'Jours presents',
    'Jours retard',
    'Jours anomalie',
    'Premiere date',
    'Derniere date',
    'Projets',
    'Positions',
    'Statut',
  ];
  const lines = [
    headers.join(','),
    ...rows.map((row) =>
      [
        row.matricule,
        row.lastName,
        row.firstName,
        row.role,
        row.totalHours,
        row.timeSpent,
        row.reviewHours,
        String(row.presentDays),
        String(row.lateDays),
        String(row.anomalyDays),
        row.firstDate,
        row.lastDate,
        row.projects,
        row.positions,
        row.status,
      ]
        .map(escapeCsvValue)
        .join(','),
    ),
  ];

  return Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
}

async function buildPeriodXlsxBuffer(
  summaryRows: PeriodSummaryRow[],
  detailRows: ExportRow[],
  anomalyRows: ExportAnomalyRow[],
) {
  const workbook = new ExcelJS.Workbook();
  const summarySheet = workbook.addWorksheet('Recap periode');
  summarySheet.columns = [
    { header: 'Matricule', key: 'matricule' },
    { header: 'Nom', key: 'lastName' },
    { header: 'Prenom', key: 'firstName' },
    { header: 'Role', key: 'role' },
    { header: 'Total heures fiables', key: 'totalHours' },
    { header: 'Temps passe fiable', key: 'timeSpent' },
    { header: 'Heures a verifier', key: 'reviewHours' },
    { header: 'Jours presents', key: 'presentDays' },
    { header: 'Jours retard', key: 'lateDays' },
    { header: 'Jours anomalie', key: 'anomalyDays' },
    { header: 'Premiere date', key: 'firstDate' },
    { header: 'Derniere date', key: 'lastDate' },
    { header: 'Projets', key: 'projects' },
    { header: 'Positions', key: 'positions' },
    { header: 'Statut', key: 'status' },
  ];
  summaryRows.forEach((row) => summarySheet.addRow(row));
  styleExportWorksheet(summarySheet);

  const detailSheet = workbook.addWorksheet('Detail sessions');
  detailSheet.columns = getExportDetailColumns();
  detailRows.forEach((row) => detailSheet.addRow(row));
  styleExportWorksheet(detailSheet);

  const anomalySheet = workbook.addWorksheet('Anomalies');
  anomalySheet.columns = [
    { header: 'Motif', key: 'reason' },
    ...getExportDetailColumns(),
  ];
  anomalyRows.forEach((row) => anomalySheet.addRow(row));
  styleExportWorksheet(anomalySheet);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function buildPeriodSummaryPdfBuffer(rows: PeriodSummaryRow[], period: { from: string; to: string }) {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const columns = [
    { label: 'matricule', key: 'matricule', width: 24 },
    { label: 'nom', key: 'lastName', width: 30 },
    { label: 'prenom', key: 'firstName', width: 34 },
    { label: 'role', key: 'role', width: 34 },
    { label: 'heures', key: 'totalHours', width: 20 },
    { label: 'jours', key: 'presentDays', width: 16 },
    { label: 'retards', key: 'lateDays', width: 18 },
    { label: 'anomalies', key: 'anomalyDays', width: 22 },
    { label: 'statut', key: 'status', width: 28 },
    { label: 'positions', key: 'positions', width: 86 },
  ];
  const scale = (pageWidth - margin * 2) / columns.reduce((sum, column) => sum + column.width, 0);
  const scaledColumns = columns.map((column) => ({ ...column, width: column.width * scale }));
  let y = margin;
  const periodLabel = `${period.from.slice(0, 10)} au ${period.to.slice(0, 10)}`;

  const drawHeader = () => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.text('Recap RH periode - ChantierPro', margin, y + 5);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text(`Periode : ${periodLabel}`, margin, y + 11);
    pdf.text(`Employes : ${rows.length}`, pageWidth - margin, y + 11, { align: 'right' });
    y += 17;

    let x = margin;
    pdf.setFillColor(239, 243, 248);
    pdf.setDrawColor(210, 219, 232);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    scaledColumns.forEach((column) => {
      pdf.rect(x, y, column.width, 9, 'FD');
      pdf.text(column.label, x + 1.5, y + 5.8);
      x += column.width;
    });
    y += 9;
  };

  drawHeader();
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);

  for (const row of rows) {
    const cells = {
      matricule: row.matricule,
      lastName: row.lastName,
      firstName: row.firstName,
      role: row.role,
      totalHours: row.totalHours,
      presentDays: String(row.presentDays),
      lateDays: String(row.lateDays),
      anomalyDays: String(row.anomalyDays),
      status: row.status,
      positions: row.positions,
    };
    const lineGroups = scaledColumns.map((column) =>
      pdf.splitTextToSize(String(cells[column.key as keyof typeof cells] ?? ''), column.width - 3) as string[],
    );
    const rowHeight = Math.max(8, ...lineGroups.map((lines) => lines.length * 3.4 + 4));

    if (y + rowHeight > pageHeight - margin) {
      pdf.addPage();
      y = margin;
      drawHeader();
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
    }

    let x = margin;
    pdf.setDrawColor(225, 231, 240);
    scaledColumns.forEach((column, index) => {
      pdf.rect(x, y, column.width, rowHeight);
      pdf.text(lineGroups[index] ?? [''], x + 1.5, y + 4.8);
      x += column.width;
    });
    y += rowHeight;
  }

  if (rows.length === 0) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.text('Aucune presence pour les filtres selectionnes.', margin, y + 10);
  }

  return Buffer.from(pdf.output('arraybuffer'));
}

function getExportDetailColumns() {
  return [
    { header: 'Matricule', key: 'matricule' },
    { header: 'Nom', key: 'lastName' },
    { header: 'Prenom', key: 'firstName' },
    { header: 'Position', key: 'position' },
    { header: 'Contexte', key: 'context' },
    { header: 'Projet', key: 'projectName' },
    { header: 'Date', key: 'date' },
    { header: 'Heure entree', key: 'arrivalTime' },
    { header: 'Heure sortie', key: 'departureTime' },
    { header: 'Duree reelle (h)', key: 'realDurationHours' },
    { header: 'Temps passe', key: 'timeSpent' },
    { header: 'Retard', key: 'isLate' },
    { header: 'Statut', key: 'status' },
  ];
}

function styleExportWorksheet(worksheet: ExcelJS.Worksheet) {
  worksheet.getRow(1).font = { bold: true };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: worksheet.columns.length },
  };
  worksheet.columns.forEach((column) => {
    let maxLength = column.header ? String(column.header).length : 10;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      maxLength = Math.max(maxLength, cell.text.length);
    });
    column.width = Math.min(Math.max(maxLength + 2, 12), 60);
  });
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
  return value === 'csv' || value === 'xlsx' || value === 'pdf' ? value : null;
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

function escapeCsvValue(value: string | null) {
  const normalized = (value ?? '').replaceAll('"', '""');
  return `"${normalized}"`;
}

function aggregateAttendanceRows(rows: ExportRow[]) {
  const groupedRows = new Map<string, ExportRow[]>();

  for (const row of rows) {
    const key = `${row.userId}:${row.date}`;
    groupedRows.set(key, [...(groupedRows.get(key) ?? []), row]);
  }

  return [...groupedRows.values()]
    .map((group) => aggregateAttendanceGroup(group))
    .sort((left, right) => left.date.localeCompare(right.date) || left.lastName.localeCompare(right.lastName) || left.firstName.localeCompare(right.firstName));
}

function aggregateAttendanceGroup(group: ExportRow[]): ExportRow {
  const sortedRows = [...group].sort((left, right) => left.arrivalTime.localeCompare(right.arrivalTime));
  const firstRow = sortedRows[0]!;
  const contexts = new Set(sortedRows.map((row) => row.context));
  const hasOffice = contexts.has('Bureau');
  const hasTerrain = sortedRows.some((row) => row.context !== 'Bureau');
  const terrainRows = sortedRows.filter((row) => row.context !== 'Bureau');
  const uniqueTerrainPositions = new Set(terrainRows.map((row) => row.position).filter(Boolean));
  const isMixed = hasOffice && hasTerrain;
  const isMultiTerrain = uniqueTerrainPositions.size > 1 || terrainRows.length > 1;
  const allSessionsClosed = sortedRows.every((row) => row.departureTime);
  const totalHours = sortedRows.reduce((sum, row) => sum + parseExportHours(row.realDurationHours), 0);

  return {
    ...firstRow,
    position: isMixed ? 'Bureau + Terrain' : isMultiTerrain ? 'Multi-chantiers' : firstRow.position,
    context: isMixed ? 'Mixte' : hasOffice && !hasTerrain ? 'Bureau' : 'Terrain',
    projectName: joinUnique(sortedRows.map((row) => row.projectName)),
    arrivalTime: sortedRows.map((row) => row.arrivalTime).filter(Boolean).sort()[0] ?? '',
    departureTime: allSessionsClosed
      ? sortedRows.map((row) => row.departureTime).filter(Boolean).sort().at(-1) ?? ''
      : '',
    realDurationHours: totalHours > 0 ? formatHours(totalHours) : '',
    timeSpent: totalHours > 0 ? formatDurationLabel(totalHours) : '',
    isLate: firstRow.isLate,
    status: aggregateAttendanceStatus(sortedRows),
    detailPositions: sortedRows.map((row) => row.detailPositions || buildAttendanceDetailPosition(row)).join('; '),
  };
}

function aggregateAttendanceStatus(rows: ExportRow[]) {
  if (rows.some((row) => row.status === 'A verifier RH')) return 'A verifier RH';
  if (rows.some((row) => row.status === 'En cours')) return 'En cours';
  if (rows.every((row) => row.status === 'Complete')) return 'Complete';
  return rows[0]?.status ?? '';
}

function parseExportHours(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function joinUnique(values: string[]) {
  return [...new Set(values.filter(Boolean))].join(', ');
}

function buildAttendanceCsvBuffer(rows: ExportRow[]) {
  const headers = [
    'numero matricule',
    'nom',
    'prenom',
    'position',
    'heure arrivee',
    'heure depart',
    'temps passee',
    'detail positions',
  ];
  const lines = [
    headers.join(','),
    ...rows.map((row) =>
      [
        row.matricule,
        row.lastName,
        row.firstName,
        buildAttendancePosition(row),
        row.arrivalTime,
        row.departureTime,
        row.timeSpent,
        row.detailPositions,
      ]
        .map(escapeCsvValue)
        .join(','),
    ),
  ];

  return Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8');
}

async function buildAttendanceXlsxBuffer(rows: ExportRow[]) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Liste presence');

  worksheet.columns = [
    { header: 'numero matricule', key: 'matricule' },
    { header: 'nom', key: 'lastName' },
    { header: 'prenom', key: 'firstName' },
    { header: 'position', key: 'attendancePosition' },
    { header: 'heure arrivee', key: 'arrivalTime' },
    { header: 'heure depart', key: 'departureTime' },
    { header: 'temps passee', key: 'timeSpent' },
    { header: 'detail positions', key: 'detailPositions' },
  ];

  worksheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    worksheet.addRow({ ...row, attendancePosition: buildAttendancePosition(row) });
  }
  worksheet.columns.forEach((column) => {
    let maxLength = column.header ? String(column.header).length : 10;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      maxLength = Math.max(maxLength, cell.text.length);
    });
    column.width = maxLength + 2;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function buildAttendancePdfBuffer(rows: ExportRow[], period: { from: string; to: string }) {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const tableWidth = pageWidth - margin * 2;
  const columns = [
    { label: 'Numero\nmatricule', key: 'matricule', width: 25 },
    { label: 'Nom', key: 'lastName', width: 30 },
    { label: 'Prenom', key: 'firstName', width: 32 },
    { label: 'Position', key: 'attendancePosition', width: 86 },
    { label: 'Arrivee', key: 'arrivalTime', width: 24 },
    { label: 'Depart', key: 'departureTime', width: 24 },
    { label: 'Duree', key: 'timeSpent', width: 28 },
    { label: 'Statut', key: 'status', width: 28 },
  ] as const;
  const scale = tableWidth / columns.reduce((sum, column) => sum + column.width, 0);
  const scaledColumns = columns.map((column) => ({ ...column, width: column.width * scale }));
  const periodLabel = `${period.from.slice(0, 10)} au ${period.to.slice(0, 10)}`;
  const rowGap = 2;
  let y = margin;

  const resetTextStyle = () => {
    pdf.setTextColor(15, 23, 42);
    pdf.setDrawColor(210, 219, 232);
    pdf.setFillColor(255, 255, 255);
    pdf.setFont('helvetica', 'normal');
  };

  const drawTitle = () => {
    resetTextStyle();
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.text('Liste de presence - ChantierPro', margin, y + 5);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text(`Periode : ${periodLabel}`, margin, y + 11);
    pdf.text(`Lignes : ${rows.length}`, pageWidth - margin, y + 11, { align: 'right' });
    y += 17;
  };

  const drawHeader = () => {
    let x = margin;
    pdf.setFillColor(239, 243, 248);
    pdf.setDrawColor(210, 219, 232);
    pdf.setTextColor(15, 23, 42);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);

    for (const column of scaledColumns) {
      const lines = pdf.splitTextToSize(column.label.replace('\\n', '\n'), column.width - 3) as string[];
      pdf.setFillColor(239, 243, 248);
      pdf.setDrawColor(210, 219, 232);
      pdf.rect(x, y, column.width, 10, 'FD');
      pdf.setTextColor(15, 23, 42);
      pdf.text(lines, x + 1.5, y + 3.7, { baseline: 'top' });
      x += column.width;
    }
    y += 10;
    resetTextStyle();
    pdf.setFontSize(8);
  };

  const drawPageHeader = () => {
    drawTitle();
    drawHeader();
  };

  const addPageIfNeeded = (height: number) => {
    if (y + height <= pageHeight - margin) return;
    pdf.addPage();
    y = margin;
    drawPageHeader();
  };

  const drawMainCells = (row: ExportRow, rowHeight: number) => {
    const cells = {
      matricule: row.matricule,
      lastName: row.lastName,
      firstName: row.firstName,
      attendancePosition: buildAttendancePdfPosition(row),
      arrivalTime: row.arrivalTime,
      departureTime: row.departureTime,
      timeSpent: row.timeSpent,
      status: row.status,
    };
    const lineGroups = scaledColumns.map((column) =>
      pdf.splitTextToSize(String(cells[column.key] ?? ''), column.width - 3) as string[],
    );

    let x = margin;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.7);
    pdf.setTextColor(15, 23, 42);
    pdf.setDrawColor(225, 231, 240);
    scaledColumns.forEach((column, index) => {
      pdf.setFillColor(255, 255, 255);
      pdf.rect(x, y, column.width, rowHeight, 'S');
      pdf.setTextColor(15, 23, 42);
      pdf.text(lineGroups[index] ?? [''], x + 1.5, y + 4.5, { baseline: 'top' });
      x += column.width;
    });
  };

  const detailHeightFor = (detailLines: string[]) => detailLines.length > 0 ? detailLines.length * 3.4 + 5 : 0;

  drawPageHeader();

  for (const row of rows) {
    const mainCells = {
      matricule: row.matricule,
      lastName: row.lastName,
      firstName: row.firstName,
      attendancePosition: buildAttendancePdfPosition(row),
      arrivalTime: row.arrivalTime,
      departureTime: row.departureTime,
      timeSpent: row.timeSpent,
      status: row.status,
    };
    const mainLineGroups = scaledColumns.map((column) =>
      pdf.splitTextToSize(String(mainCells[column.key] ?? ''), column.width - 3) as string[],
    );
    const mainRowHeight = Math.max(9, ...mainLineGroups.map((lines) => lines.length * 3.4 + 5));
    const detailText = row.detailPositions?.trim() ?? '';
    const detailLines = detailText ? pdf.splitTextToSize(`Detail : ${detailText}`, tableWidth - 5) as string[] : [];
    const detailHeight = detailHeightFor(detailLines);
    const totalRowHeight = mainRowHeight + detailHeight + rowGap;

    addPageIfNeeded(totalRowHeight);
    drawMainCells(row, mainRowHeight);
    y += mainRowHeight;

    if (detailLines.length > 0) {
      pdf.setFillColor(248, 250, 252);
      pdf.setDrawColor(225, 231, 240);
      pdf.rect(margin, y, tableWidth, detailHeight, 'FD');
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.3);
      pdf.setTextColor(71, 85, 105);
      pdf.text(detailLines, margin + 2, y + 3.5, { baseline: 'top' });
      y += detailHeight;
    }

    y += rowGap;
  }

  if (rows.length === 0) {
    resetTextStyle();
    pdf.setFontSize(10);
    pdf.text('Aucune presence pour les filtres selectionnes.', margin, y + 10);
  }

  return Buffer.from(pdf.output('arraybuffer'));
}
function buildAttendancePdfPosition(row: ExportRow) {
  if (row.context === 'Mixte') {
    return row.position || 'Bureau + Terrain';
  }

  return row.position || buildAttendancePosition(row);
}

function buildAttendancePosition(row: ExportRow) {
  if (row.context === 'Mixte') {
    return 'Mixte - Bureau + Terrain';
  }

  return `${row.context === 'Bureau' ? 'Bureau' : 'Terrain'} - ${row.position}`;
}

function buildAttendanceDetailPosition(row: Pick<ExportRow, 'position' | 'context' | 'arrivalTime' | 'departureTime' | 'status'>) {
  const prefix = row.context === 'Bureau' ? 'Bureau' : row.context === 'Mixte' ? 'Mixte' : 'Terrain';
  const timeRange = row.departureTime
    ? `${row.arrivalTime || '-'}-${row.departureTime}`
    : row.arrivalTime
      ? `${row.arrivalTime}-en cours`
      : row.status || 'absent';

  return `${prefix} ${row.position}: ${timeRange}`;
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
    (left.siteId ?? left.projectId ?? '').localeCompare(right.siteId ?? right.projectId ?? '')
  );
}

function matchesRhSearch(session: BuiltSession, search: string) {
  const normalized = search.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return `${session.firstName} ${session.lastName} ${session.email} ${session.position} ${session.projectName ?? ''} ${session.role}`
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

async function buildDirectionAttendanceXlsxBuffer(report: RhDirectionAttendanceReportResponse, scope: DirectionAttendanceExportScope) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ChantierPro';
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet('Synthese');
  summarySheet.columns = [
    { header: 'Indicateur', key: 'label' },
    { header: 'Valeur', key: 'value' },
  ];
  summarySheet.addRows([
    { label: 'Date', value: report.date },
    { label: 'Utilisateurs actifs', value: report.summary.activeUsers },
    { label: 'Ont pointe', value: report.summary.clockedToday },
    { label: 'Pas pointe ce jour', value: report.summary.notClockedToday },
    { label: 'Aucun pointage', value: report.summary.neverClocked },
    { label: 'Sortis', value: report.summary.leftToday },
    { label: 'Sessions ouvertes', value: report.summary.openSessions },
    { label: 'Retards', value: report.summary.lateToday },
    { label: 'Sortie sans entree', value: report.summary.departureOnlyToday },
    { label: 'Emis le', value: formatDirectionDateTime(report.generatedAt) },
  ]);
  styleExportWorksheet(summarySheet);

  getDirectionAttendanceExportSections(report, scope).forEach((section) => {
    addDirectionUsersWorksheet(workbook, section.sheetName, section.users);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

type DirectionAttendanceExportSection = {
  scope: Exclude<DirectionAttendanceExportScope, 'all'>;
  sheetName: string;
  title: string;
  users: RhDirectionAttendanceReportResponse['users']['clockedToday'];
};

type DirectionAttendancePdfMetric = {
  label: string;
  value: string | number;
};

function getDirectionAttendanceExportSections(
  report: RhDirectionAttendanceReportResponse,
  scope: DirectionAttendanceExportScope,
): DirectionAttendanceExportSection[] {
  const sections: DirectionAttendanceExportSection[] = [
    { scope: 'not-clocked-today', sheetName: 'Pas pointe', title: "Pas pointe aujourd'hui", users: report.users.notClockedToday },
    { scope: 'never-clocked', sheetName: 'Jamais pointe', title: 'Aucun pointage enregistre', users: report.users.neverClocked },
    { scope: 'clocked-today', sheetName: 'Ont pointe', title: "Ont pointe aujourd'hui", users: report.users.clockedToday },
    { scope: 'departure-only', sheetName: 'Sortie seule', title: 'Sortie sans entree', users: report.users.departureOnlyToday },
  ];

  return scope === 'all' ? sections : sections.filter((section) => section.scope === scope);
}

function addDirectionUsersWorksheet(workbook: ExcelJS.Workbook, name: string, users: RhDirectionAttendanceReportResponse['users']['clockedToday']) {
  const worksheet = workbook.addWorksheet(name);
  worksheet.columns = getDirectionUsersColumns();
  users.forEach((user) => worksheet.addRow(toDirectionExportRow(user)));
  styleExportWorksheet(worksheet);
}

function getDirectionUsersColumns() {
  return [
    { header: 'Matricule', key: 'matricule' },
    { header: 'Nom', key: 'lastName' },
    { header: 'Prenom', key: 'firstName' },
    { header: 'Role', key: 'role' },
    { header: 'Entree jour', key: 'todayArrivalAt' },
    { header: 'Sortie jour', key: 'todayDepartureAt' },
    { header: 'Nb pointages jour', key: 'todayClockInCount' },
    { header: 'Premier pointage', key: 'firstClockInAt' },
    { header: 'Dernier pointage', key: 'lastClockInAt' },
    { header: 'Compte cree', key: 'createdAt' },
    { header: 'Statut', key: 'status' },
    { header: 'Email', key: 'email' },
  ];
}

function toDirectionExportRow(user: RhDirectionAttendanceReportResponse['users']['clockedToday'][number]) {
  return {
    matricule: user.matricule ?? '',
    lastName: user.lastName,
    firstName: user.firstName,
    role: formatRoleLabel(user.role as Role),
    todayArrivalAt: user.todayArrivalAt ? formatDirectionTime(user.todayArrivalAt) : '',
    todayDepartureAt: user.todayDepartureAt ? formatDirectionTime(user.todayDepartureAt) : '',
    todayClockInCount: user.todayClockInCount,
    firstClockInAt: user.firstClockInAt ? formatDirectionDateTime(user.firstClockInAt) : '',
    lastClockInAt: user.lastClockInAt ? formatDirectionDateTime(user.lastClockInAt) : '',
    createdAt: formatDirectionDate(user.createdAt),
    status: directionAttendanceStatusLabel(user.status),
    email: user.email ?? '',
  };
}

function buildDirectionAttendancePdfBuffer(report: RhDirectionAttendanceReportResponse, scope: DirectionAttendanceExportScope) {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  let y = margin;

  pdf.setTextColor(15, 23, 42);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text('Rapport de suivi du pointage', margin, y + 5);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(71, 85, 105);
  pdf.text(`Date de reference : ${formatDirectionDate(report.date)}`, margin, y + 12);
  pdf.text(`Emis le : ${formatDirectionDateTime(report.generatedAt)}`, pageWidth - margin, y + 12, { align: 'right' });
  pdf.setDrawColor(226, 232, 240);
  pdf.line(margin, y + 16, pageWidth - margin, y + 16);
  y += 24;

  const sections = getDirectionAttendanceExportSections(report, scope);
  const metrics = getDirectionAttendancePdfMetrics(report, scope, sections);
  const metricColumns = scope === 'all' ? 4 : Math.min(metrics.length, 3);
  const metricWidth = (pageWidth - margin * 2) / metricColumns;
  metrics.forEach(({ label, value }, index) => {
    const x = margin + (index % metricColumns) * metricWidth;
    if (index > 0 && index % metricColumns === 0) y += 18;
    pdf.setFillColor(248, 250, 252);
    pdf.setDrawColor(226, 232, 240);
    pdf.rect(x, y, metricWidth - 3, 14, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.setTextColor(71, 85, 105);
    pdf.text(label.toUpperCase(), x + 2, y + 5);
    pdf.setFontSize(12);
    pdf.setTextColor(15, 23, 42);
    const metricValue = pdf.splitTextToSize(String(value), metricWidth - 7) as string[];
    pdf.text(metricValue.slice(0, 1), x + 2, y + 11);
  });
  y += scope === 'all' ? 24 : 18;

  for (const section of sections) {
    y = drawDirectionPdfSection(pdf, section.title, section.users, y, margin, pageWidth, pageHeight);
  }

  return Buffer.from(pdf.output('arraybuffer'));
}

function getDirectionAttendancePdfMetrics(
  report: RhDirectionAttendanceReportResponse,
  scope: DirectionAttendanceExportScope,
  sections: DirectionAttendanceExportSection[],
): DirectionAttendancePdfMetric[] {
  if (scope === 'all') {
    return [
      { label: 'Utilisateurs actifs', value: report.summary.activeUsers },
      { label: 'Ont pointe', value: report.summary.clockedToday },
      { label: 'Pas pointe ce jour', value: report.summary.notClockedToday },
      { label: 'Aucun pointage', value: report.summary.neverClocked },
      { label: 'Sortis', value: report.summary.leftToday },
      { label: 'Sessions ouvertes', value: report.summary.openSessions },
      { label: 'Retards', value: report.summary.lateToday },
      { label: 'Sortie sans entree', value: report.summary.departureOnlyToday },
    ];
  }

  const selectedSection = sections[0];
  return [
    { label: 'Perimetre exporte', value: selectedSection?.title ?? 'Filtre' },
    { label: 'Utilisateurs concernes', value: selectedSection?.users.length ?? 0 },
    { label: 'Utilisateurs actifs', value: report.summary.activeUsers },
  ];
}

function drawDirectionPdfSection(
  pdf: jsPDF,
  title: string,
  users: RhDirectionAttendanceReportResponse['users']['clockedToday'],
  yStart: number,
  margin: number,
  pageWidth: number,
  pageHeight: number,
) {
  let y = yStart;
  const columns = [
    { label: 'Matricule', width: 24, value: (user: RhDirectionAttendanceReportResponse['users']['clockedToday'][number]) => user.matricule ?? '' },
    { label: 'Nom', width: 38, value: (user: RhDirectionAttendanceReportResponse['users']['clockedToday'][number]) => user.lastName },
    { label: 'Prenom', width: 42, value: (user: RhDirectionAttendanceReportResponse['users']['clockedToday'][number]) => user.firstName },
    { label: 'Role', width: 38, value: (user: RhDirectionAttendanceReportResponse['users']['clockedToday'][number]) => formatRoleLabel(user.role as Role) },
    { label: 'Entree', width: 22, value: (user: RhDirectionAttendanceReportResponse['users']['clockedToday'][number]) => user.todayArrivalAt ? formatDirectionTime(user.todayArrivalAt) : '-' },
    { label: 'Sortie', width: 22, value: (user: RhDirectionAttendanceReportResponse['users']['clockedToday'][number]) => user.todayDepartureAt ? formatDirectionTime(user.todayDepartureAt) : '-' },
    { label: 'Dernier pointage', width: 46, value: (user: RhDirectionAttendanceReportResponse['users']['clockedToday'][number]) => user.lastClockInAt ? formatDirectionDateTime(user.lastClockInAt) : '-' },
    { label: 'Statut', width: 32, value: (user: RhDirectionAttendanceReportResponse['users']['clockedToday'][number]) => directionAttendanceStatusLabel(user.status) },
  ];
  const scale = (pageWidth - margin * 2) / columns.reduce((sum, column) => sum + column.width, 0);
  const scaledColumns = columns.map((column) => ({ ...column, width: column.width * scale }));

  const drawSectionHeader = () => {
    if (y + 18 > pageHeight - margin) {
      pdf.addPage();
      y = margin;
    }
    pdf.setTextColor(15, 23, 42);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text(`${title} (${users.length})`, margin, y + 5);
    y += 8;
    let x = margin;
    pdf.setFontSize(7.5);
    scaledColumns.forEach((column) => {
      pdf.setFillColor(241, 245, 249);
      pdf.setDrawColor(203, 213, 225);
      pdf.setTextColor(30, 41, 59);
      pdf.rect(x, y, column.width, 8, 'FD');
      pdf.text(column.label, x + 1.5, y + 5.2);
      x += column.width;
    });
    y += 8;
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(15, 23, 42);
  };

  drawSectionHeader();
  if (users.length === 0) {
    pdf.setFontSize(8);
    pdf.setTextColor(71, 85, 105);
    pdf.text('Aucun utilisateur.', margin, y + 5);
    return y + 11;
  }

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(15, 23, 42);
  for (const user of users) {
    const lineGroups = scaledColumns.map((column) => pdf.splitTextToSize(String(column.value(user)), column.width - 3) as string[]);
    const rowHeight = Math.max(7, ...lineGroups.map((lines) => lines.length * 3.2 + 3));
    if (y + rowHeight > pageHeight - margin) {
      pdf.addPage();
      y = margin;
      drawSectionHeader();
      pdf.setFontSize(7.5);
      pdf.setTextColor(15, 23, 42);
    }
    let x = margin;
    scaledColumns.forEach((column, index) => {
      pdf.setFillColor(255, 255, 255);
      pdf.setDrawColor(226, 232, 240);
      pdf.setTextColor(15, 23, 42);
      pdf.rect(x, y, column.width, rowHeight);
      pdf.text(lineGroups[index] ?? [''], x + 1.5, y + 4.5);
      x += column.width;
    });
    y += rowHeight;
  }

  return y + 7;
}

function directionAttendanceStatusLabel(status: RhDirectionAttendanceReportResponse['users']['clockedToday'][number]['status']) {
  if (status === 'CLOCKED_TODAY') return 'Pointe';
  if (status === 'NEVER_CLOCKED') return 'Aucun pointage';
  return 'Non pointe ce jour';
}

function formatDirectionDate(value: string) {
  return new Date(value).toLocaleDateString('fr-FR');
}

function formatDirectionDateTime(value: string) {
  const date = new Date(value);
  return `${date.toLocaleDateString('fr-FR')} ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatDirectionTime(value: string) {
  return new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function isDateInRange(value: Date, start: Date, end: Date) {
  const time = value.getTime();
  return time >= start.getTime() && time < end.getTime();
}

function minIsoDate(values: (Date | null | undefined)[]) {
  const dates = values.filter((value): value is Date => Boolean(value));
  if (dates.length === 0) return null;
  return new Date(Math.min(...dates.map((value) => value.getTime()))).toISOString();
}

function maxIsoDate(values: (Date | null | undefined)[]) {
  const dates = values.filter((value): value is Date => Boolean(value));
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((value) => value.getTime()))).toISOString();
}

function toDirectionAttendanceUser(user: {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  matricule: string | null;
  role: Role;
  createdAt: string;
  lastClockInAt: string | null;
  firstClockInAt: string | null;
  todayArrivalAt: string | null;
  todayDepartureAt: string | null;
  todayClockInCount: number;
  status: 'CLOCKED_TODAY' | 'NOT_CLOCKED_TODAY' | 'NEVER_CLOCKED';
}) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    matricule: user.matricule,
    role: user.role,
    createdAt: user.createdAt,
    lastClockInAt: user.lastClockInAt,
    firstClockInAt: user.firstClockInAt,
    todayArrivalAt: user.todayArrivalAt,
    todayDepartureAt: user.todayDepartureAt,
    todayClockInCount: user.todayClockInCount,
    status: user.status,
  };
}

function parseLiveStatus(value: string | null): RhSitePresenceLiveStatus | null {
  const statuses: RhSitePresenceLiveStatus[] = ['PRESENT', 'PAUSED', 'EXPECTED_NOT_CLOCKED', 'LEFT', 'ANOMALY'];
  return statuses.includes(value as RhSitePresenceLiveStatus) ? (value as RhSitePresenceLiveStatus) : null;
}

function parseTimeOfDayMinutes(value: string | null) {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function parsePresenceContext(value: string | null): 'TERRAIN' | 'OFFICE' | null {
  if (value === 'TERRAIN' || value === 'OFFICE') {
    return value;
  }

  return null;
}

function parseDateOnly(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toDateOnlyDate(value: Date) {
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

function liveResourceKey(siteId: string, userId: string) {
  return JSON.stringify([siteId, userId]);
}

function parseLiveResourceKey(key: string) {
  try {
    const parsed = JSON.parse(key) as unknown;
    if (
      Array.isArray(parsed) &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string'
    ) {
      return { siteId: parsed[0], userId: parsed[1] };
    }
  } catch {
    // Fall back to the legacy delimiter for older in-memory keys.
  }

  const [siteId = '', userId = ''] = key.split(':');
  return { siteId, userId };
}

function getOfficeTaskAction(
  records: {
    planningAssignment?: {
      action: string;
      workLocationType: string;
    } | null;
  }[],
) {
  const actions = [
    ...new Set(
      records
        .filter((record) => record.planningAssignment?.workLocationType === 'OFFICE')
        .map((record) => record.planningAssignment?.action.trim())
        .filter((action): action is string => Boolean(action)),
    ),
  ];

  return actions.length > 0 ? actions.join(' / ') : null;
}

function buildLiveResource(
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    role: Role;
  },
  taskAction: string | null,
  records: {
    id?: string;
    type: ClockInType;
    timestampLocal: Date;
    distanceToSite: Prisma.Decimal;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
    accuracy: Prisma.Decimal | null;
    isRemoteCheckout: boolean;
    isAutoClosed: boolean;
    isRegularized: boolean;
    isLate: boolean;
    comment?: string | null;
  }[],
  presenceContext: 'TERRAIN' | 'OFFICE',
  referenceDate: Date,
): RhSitePresenceLiveResource {
  const latest = records.at(-1) ?? null;
  const arrivalIndex = findLastRecordIndex(records, (record) => record.type === ClockInType.ARRIVAL);
  const arrival = arrivalIndex === -1 ? null : records[arrivalIndex] ?? null;
  const departure = arrivalIndex === -1
    ? null
    : [...records.slice(arrivalIndex + 1)].reverse().find((record) => record.type === ClockInType.DEPARTURE) ?? null;
  const today = referenceDate.toISOString().slice(0, 10);
  const hasTodayRecord = records.some((record) => record.timestampLocal.toISOString().slice(0, 10) === today);
  const hasStaleOpenSession =
    Boolean(arrival) &&
    !departure &&
    arrival!.timestampLocal.toISOString().slice(0, 10) !== today;
  const hasStaleOpenSessionWithoutToday = hasStaleOpenSession && !hasTodayRecord;
  const hasAnomaly = records.some((record) => record.isAutoClosed) || (hasStaleOpenSession && hasTodayRecord);
  const status = hasStaleOpenSessionWithoutToday
    ? 'EXPECTED_NOT_CLOCKED'
    : hasAnomaly
      ? 'ANOMALY'
      : getLiveStatusFromLatestRecord(latest);
  const anomalyReason = getLiveAnomalyReason({
    records,
    hasStaleOpenSession,
  });
  const zoneDetails = extractZoneClockInDetails(arrival?.comment ?? latest?.comment ?? null);
  const comments = collectPresenceComments(records, zoneDetails.comment);
  const displayTaskAction = zoneDetails.outOfPlanningTaskText ?? (presenceContext === 'OFFICE' ? zoneDetails.reason : null) ?? taskAction;

  return {
    userId: user.id,
    name: `${user.firstName} ${user.lastName}`,
    email: user.email,
    role: user.role,
    presenceContext,
    status,
    taskAction: displayTaskAction,
    arrivalRecordId: arrival?.id ?? null,
    arrivalAt: arrival?.timestampLocal.toISOString() ?? null,
    lastClockInAt: latest?.timestampLocal.toISOString() ?? null,
    lastClockInType: latest?.type ?? null,
    distanceKm: latest?.distanceToSite.toNumber() ?? null,
    arrivalGps: serializeGpsPoint(arrival),
    departureGps: serializeGpsPoint(departure),
    isRemoteCheckout: records.some((record) => record.isRemoteCheckout),
    isAutoClosed: records.some((record) => record.isAutoClosed),
    isRegularized: records.some((record) => record.isRegularized),
    anomalyReason,
    isLate: Boolean(arrival?.timestampLocal.toISOString().slice(0, 10) === today && arrival.isLate),
    zoneActualName: zoneDetails.actualZone,
    zoneSpecificPlace: zoneDetails.specificPlace,
    zoneComment: zoneDetails.comment,
    comments,
    outOfPlanningValidationStatus: zoneDetails.outOfPlanningValidationStatus,
    outOfPlanningValidationLabel: zoneDetails.outOfPlanningValidationLabel,
    outOfPlanningTaskText: zoneDetails.outOfPlanningTaskText,
    outOfPlanningDecisionNote: zoneDetails.outOfPlanningDecisionNote,
  };
}

function collectPresenceComments(records: { type: ClockInType; timestampLocal: Date; comment?: string | null }[], structuredComment: string | null) {
  const comments: { type: ClockInType; label: string; comment: string; recordedAt: string }[] = [];
  const addComment = (record: { type: ClockInType; timestampLocal: Date }, value: string | null | undefined) => {
    const normalized = value?.trim();
    if (!normalized) return;
    if (comments.some((item) => item.type === record.type && item.comment.toLowerCase() === normalized.toLowerCase())) return;

    comments.push({
      type: record.type,
      label: clockInCommentLabel(record.type),
      comment: normalized,
      recordedAt: record.timestampLocal.toISOString(),
    });
  };

  for (const record of records) {
    const rawComment = record.comment?.trim();
    if (!rawComment) continue;

    const details = extractZoneClockInDetails(rawComment);
    addComment(record, details.comment);

    if (!isStructuredPresenceComment(rawComment)) {
      addComment(record, rawComment);
    }
  }

  if (structuredComment && !comments.some((item) => item.comment.toLowerCase() === structuredComment.toLowerCase())) {
    const arrival = records.find((record) => record.type === ClockInType.ARRIVAL) ?? records[0];
    if (arrival) addComment(arrival, structuredComment);
  }

  return comments;
}

function clockInCommentLabel(type: ClockInType) {
  if (type === ClockInType.ARRIVAL) return 'Commentaire arrivee';
  if (type === ClockInType.DEPARTURE) return 'Commentaire depart';
  if (type === ClockInType.PAUSE_START) return 'Commentaire debut pause';
  if (type === ClockInType.PAUSE_END) return 'Commentaire reprise';
  return 'Commentaire';
}

function isStructuredPresenceComment(comment: string) {
  return /^(zone reelle|ville \/ zone reelle|lieu\/quartier|lieu precis|motif|commentaire|validation pm|taches prevues|taches declarees|tache declaree|note pm)\s*:/im.test(comment);
}
function extractZoneClockInDetails(comment: string | null | undefined) {
  const empty = {
    actualZone: null as string | null,
    specificPlace: null as string | null,
    reason: null as string | null,
    comment: null as string | null,
    outOfPlanningValidationStatus: null as 'PENDING' | 'VALIDATED' | 'REFUSED' | null,
    outOfPlanningValidationLabel: null as string | null,
    outOfPlanningTaskText: null as string | null,
    outOfPlanningDecisionNote: null as string | null,
  };

  if (!comment) return empty;

  const lines = comment.split(/\r?\n/);
  const readValue = (prefix: string) => {
    const line = lines.find((item) => item.toLowerCase().startsWith(prefix.toLowerCase()));
    const value = line?.slice(prefix.length).trim();
    if (!value) return null;
    return value;
  };

  const readAnyValue = (...prefixes: string[]) => {
    for (const prefix of prefixes) {
      const value = readValue(prefix);
      if (value) return value;
    }

    return null;
  };

  const validationLabel = readValue('Validation PM :');

  return {
    actualZone: readAnyValue('Zone reelle :', 'Ville / zone reelle :'),
    specificPlace: readAnyValue('Lieu/quartier :', 'Lieu precis :'),
    reason: readValue('Motif :'),
    comment: readValue('Commentaire :'),
    outOfPlanningValidationStatus: getOutOfPlanningValidationStatus(validationLabel),
    outOfPlanningValidationLabel: validationLabel,
    outOfPlanningTaskText: readAnyValue('Taches prevues :', 'Taches declarees :', 'Tache declaree :'),
    outOfPlanningDecisionNote: readValue('Note PM :'),
  };
}

function getOutOfPlanningValidationStatus(value: string | null): 'PENDING' | 'VALIDATED' | 'REFUSED' | null {
  const normalized = value?.toLowerCase() ?? '';
  if (normalized.startsWith('valide')) return 'VALIDATED';
  if (normalized.startsWith('refuse')) return 'REFUSED';
  if (normalized.startsWith('en attente')) return 'PENDING';
  return null;
}

function findLastRecordIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index]!)) return index;
  }

  return -1;
}

function isLateArrival(value: Date) {
  const hour = value.getUTCHours();
  const minute = value.getUTCMinutes();
  return hour > 8 || (hour === 8 && minute > 30);
}

function getLiveAnomalyReason({
  records,
  hasStaleOpenSession,
}: {
  records: {
    isRemoteCheckout: boolean;
    isAutoClosed: boolean;
    isRegularized: boolean;
  }[];
  hasStaleOpenSession: boolean;
}) {
  if (hasStaleOpenSession) return 'Sortie oubliee';
  if (records.some((record) => record.isAutoClosed || record.isRegularized)) return 'Sortie deja regularisee';
  return null;
}

function serializeGpsPoint(record: {
  latitude: Prisma.Decimal | null;
  longitude: Prisma.Decimal | null;
  accuracy: Prisma.Decimal | null;
  timestampLocal: Date;
} | null) {
  if (!record?.latitude || !record.longitude) {
    return null;
  }

  return {
    latitude: record.latitude.toNumber(),
    longitude: record.longitude.toNumber(),
    accuracy: record.accuracy?.toNumber() ?? null,
    recordedAt: record.timestampLocal.toISOString(),
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

function matchesLiveResourceFilters(
  resource: RhSitePresenceLiveResource,
  query: SitePresenceLiveQuery,
  usersWithPresenceInScope: Set<string>,
) {
  if (query.status === 'EXPECTED_NOT_CLOCKED' && !query.siteId && usersWithPresenceInScope.has(resource.userId)) {
    return false;
  }
  if (query.status && resource.status !== query.status) return false;
  if (query.anomaliesOnly && resource.status !== 'ANOMALY' && !resource.anomalyReason) return false;
  if (query.lateOnly && !resource.isLate) return false;
  if (!matchesArrivalTimeFilter(resource.arrivalAt, query)) return false;

  if (query.search) {
    const normalized = query.search.toLowerCase();
    return `${resource.name} ${resource.email} ${resource.role} ${resource.taskAction ?? ''}`
      .toLowerCase()
      .includes(normalized);
  }

  return true;
}

function matchesArrivalTimeFilter(
  arrivalAt: string | null,
  query: Pick<SitePresenceLiveQuery, 'arrivalFromMinutes' | 'arrivalToMinutes'>,
) {
  if (query.arrivalFromMinutes === null && query.arrivalToMinutes === null) return true;
  if (!arrivalAt) return false;

  const arrivalDate = new Date(arrivalAt);
  const arrivalMinutes = arrivalDate.getUTCHours() * 60 + arrivalDate.getUTCMinutes();

  if (query.arrivalFromMinutes !== null && arrivalMinutes < query.arrivalFromMinutes) return false;
  if (query.arrivalToMinutes !== null && arrivalMinutes > query.arrivalToMinutes) return false;
  return true;
}

function hasLivePresenceDuringSelectedDay(resource: Pick<RhSitePresenceLiveResource, 'arrivalAt' | 'status'>) {
  return Boolean(resource.arrivalAt) && resource.status !== 'EXPECTED_NOT_CLOCKED';
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

function formatPersonName(person: { firstName: string; lastName: string } | null) {
  if (!person) return 'Non renseignÃ©';
  return `${person.firstName} ${person.lastName}`.trim();
}
