import {
  ClockInStatus,
  ClockInType,
  Prisma,
  ProjectStatus,
  Role,
  SiteStatus,
  TeamMemberStatus,
  TeamStatus,
  type PrismaClient,
} from '@prisma/client';
import type {
  DirectionActiveSiteItem,
  DirectionActiveSitesResponse,
  DirectionAlertsResponse,
  DirectionApiErrorCode,
  DirectionConsolidatedProjectItem,
  DirectionConsolidatedProjectsResponse,
  DirectionKpisResponse,
} from '@/types/direction';

const DIRECTION_ALLOWED_ROLES: readonly Role[] = [Role.DIRECTION, Role.ADMIN];

const activeSiteSelect = {
  id: true,
  projectId: true,
  name: true,
  address: true,
  latitude: true,
  longitude: true,
  radiusKm: true,
  project: {
    select: {
      name: true,
    },
  },
} satisfies Prisma.SiteSelect;

const alertProjectSelect = {
  id: true,
  name: true,
} satisfies Prisma.ProjectSelect;

const alertSiteSelect = {
  id: true,
  name: true,
  status: true,
  projectId: true,
  project: {
    select: alertProjectSelect,
  },
} satisfies Prisma.SiteSelect;

type SerializableActiveSite = Prisma.SiteGetPayload<{
  select: typeof activeSiteSelect;
}>;

type AlertUser = {
  id: string;
  firstName: string;
  lastName: string;
  role: Role;
};

type SessionSourceRecord = {
  id: string;
  siteId: string;
  userId: string;
  type: ClockInType;
  status: ClockInStatus;
  timestampLocal: Date;
  distanceToSite: Prisma.Decimal;
  site: {
    id: string;
    name: string;
    projectId: string;
    project: {
      id: string;
      name: string;
    };
  };
  user: AlertUser;
};

type BuiltSession = {
  siteId: string;
  siteName: string;
  projectId: string;
  projectName: string;
  userId: string;
  firstName: string;
  lastName: string;
  role: Role;
  startedAt: Date;
  arrivalDistanceMeters: number;
  realDurationHours: number | null;
  incomplete: boolean;
};

type DirectionPeriodQuery = {
  month: number;
  year: number;
};

type DirectionConsolidatedQuery = DirectionPeriodQuery & {
  status: ProjectStatus | null;
  projectManager: string | null;
};

export function jsonDirectionError(code: DirectionApiErrorCode, status: number, message: string) {
  return Response.json(
    {
      code,
      message,
    },
    { status },
  );
}

export function canAccessDirection(role: Role) {
  return DIRECTION_ALLOWED_ROLES.includes(role);
}

export function parseDirectionPeriodQuery(searchParams: URLSearchParams): DirectionPeriodQuery | null {
  const currentDate = new Date();
  const rawMonth = searchParams.get('month');
  const rawYear = searchParams.get('year');
  const parsedMonth = parseMonth(rawMonth);
  const parsedYear = parseYear(rawYear);

  if ((rawMonth && parsedMonth === null) || (rawYear && parsedYear === null)) {
    return null;
  }

  return {
    month: parsedMonth ?? currentDate.getUTCMonth() + 1,
    year: parsedYear ?? currentDate.getUTCFullYear(),
  };
}

export function parseDirectionConsolidatedQuery(
  searchParams: URLSearchParams,
): DirectionConsolidatedQuery | null {
  const base = parseDirectionPeriodQuery(searchParams);

  if (!base) {
    return null;
  }

  const status = parseProjectStatus(searchParams.get('status'));
  const projectManager = sanitizeString(searchParams.get('projectManager'));

  return {
    ...base,
    status,
    projectManager,
  };
}

export async function getDirectionKpis(
  prisma: PrismaClient,
  query: DirectionPeriodQuery,
): Promise<DirectionKpisResponse> {
  const currentRange = monthRange(query.year, query.month);
  const previous = previousMonth(query.year, query.month);
  const previousRange = monthRange(previous.year, previous.month);

  const [inProgress, completed, onHold, currentSessions, previousSessions, currentPhotos, previousPhotos] =
    await Promise.all([
      prisma.project.count({
        where: {
          status: ProjectStatus.IN_PROGRESS,
        },
      }),
      prisma.project.count({
        where: {
          status: ProjectStatus.COMPLETED,
        },
      }),
      prisma.project.count({
        where: {
          status: ProjectStatus.ON_HOLD,
        },
      }),
      countCompleteSessionsInRange(prisma, currentRange.from, currentRange.to, null),
      countCompleteSessionsInRange(prisma, previousRange.from, previousRange.to, null),
      prisma.photo.count({
        where: {
          isDeleted: false,
          timestampLocal: {
            gte: currentRange.from,
            lte: currentRange.to,
          },
        },
      }),
      prisma.photo.count({
        where: {
          isDeleted: false,
          timestampLocal: {
            gte: previousRange.from,
            lte: previousRange.to,
          },
        },
      }),
    ]);

  return {
    month: query.month,
    year: query.year,
    projects: {
      inProgress,
      completed,
      onHold,
    },
    presences: {
      currentMonth: currentSessions,
      previousMonth: previousSessions,
      deltaPercent: calculateDeltaPercent(currentSessions, previousSessions),
    },
    photos: {
      currentMonth: currentPhotos,
      previousMonth: previousPhotos,
      deltaPercent: calculateDeltaPercent(currentPhotos, previousPhotos),
    },
  };
}

export async function getDirectionProjectsConsolidated(
  prisma: PrismaClient,
  query: DirectionConsolidatedQuery,
): Promise<DirectionConsolidatedProjectsResponse> {
  const range = monthRange(query.year, query.month);
  const projects = await prisma.project.findMany({
    where: {
      ...(query.status ? { status: query.status } : {}),
      ...(query.projectManager ? { projectManagerId: query.projectManager } : {}),
    },
    select: {
      id: true,
      name: true,
      status: true,
      projectManager: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      sites: {
        select: {
          id: true,
          status: true,
          teams: {
            where: {
              status: TeamStatus.ACTIVE,
            },
            select: {
              members: {
                where: {
                  status: TeamMemberStatus.ACTIVE,
                },
                select: {
                  userId: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  const alerts = await getDirectionAlerts(prisma);
  const projectAlertCounts = buildProjectAlertCountMap(alerts);
  const projectIds = projects.map((project) => project.id);

  const [sessions, photoCounts] = await Promise.all([
    getCompleteSessionsForRange(prisma, range.from, range.to, projectIds.length > 0 ? projectIds : null),
    prisma.photo.groupBy({
      by: ['siteId'],
      where: {
        isDeleted: false,
        timestampLocal: {
          gte: range.from,
          lte: range.to,
        },
        ...(projectIds.length > 0
          ? {
              site: {
                projectId: {
                  in: projectIds,
                },
              },
            }
          : {}),
      },
      _count: {
        _all: true,
      },
    }),
  ]);

  const hoursByProjectId = new Map<string, number>();

  for (const session of sessions) {
    hoursByProjectId.set(
      session.projectId,
      round2((hoursByProjectId.get(session.projectId) ?? 0) + (session.realDurationHours ?? 0)),
    );
  }

  const photosByProjectId = new Map<string, number>();
  const siteToProjectId = new Map<string, string>();

  for (const project of projects) {
    for (const site of project.sites) {
      siteToProjectId.set(site.id, project.id);
    }
  }

  for (const photoCount of photoCounts) {
    const projectId = siteToProjectId.get(photoCount.siteId);

    if (!projectId) {
      continue;
    }

    photosByProjectId.set(projectId, (photosByProjectId.get(projectId) ?? 0) + photoCount._count._all);
  }

  const items: DirectionConsolidatedProjectItem[] = projects.map((project) => {
    const resources = new Set<string>();

    for (const site of project.sites) {
      for (const team of site.teams) {
        for (const member of team.members) {
          resources.add(member.userId);
        }
      }
    }

    return {
      projectId: project.id,
      projectName: project.name,
      projectStatus: project.status,
      projectManager: {
        id: project.projectManager.id,
        firstName: project.projectManager.firstName,
        lastName: project.projectManager.lastName,
      },
      sitesCount: project.sites.length,
      resourcesCount: resources.size,
      hoursMonth: round2(hoursByProjectId.get(project.id) ?? 0),
      photosMonth: photosByProjectId.get(project.id) ?? 0,
      alertsCount: projectAlertCounts.get(project.id) ?? 0,
    };
  });

  return {
    month: query.month,
    year: query.year,
    items,
  };
}

export async function getDirectionActiveSites(
  prisma: PrismaClient,
): Promise<DirectionActiveSitesResponse> {
  const sites = await prisma.site.findMany({
    where: {
      status: SiteStatus.ACTIVE,
    },
    select: activeSiteSelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  return {
    items: sites.map(serializeDirectionActiveSite),
  };
}

export async function getDirectionAlerts(prisma: PrismaClient): Promise<DirectionAlertsResponse> {
  const now = new Date();
  const sitePresenceThreshold = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const incompleteThreshold = new Date(now.getTime() - 12 * 60 * 60 * 1000);

  const [activeSites, lastPresenceRecords, activeMemberships, allRelevantRecords] = await Promise.all([
    prisma.site.findMany({
      where: {
        status: SiteStatus.ACTIVE,
      },
      select: alertSiteSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
    prisma.clockInRecord.findMany({
      where: {
        status: ClockInStatus.VALID,
        type: {
          in: [ClockInType.ARRIVAL, ClockInType.INTERMEDIATE],
        },
      },
      orderBy: [{ timestampLocal: 'desc' }, { id: 'desc' }],
      select: {
        siteId: true,
        userId: true,
        timestampLocal: true,
      },
    }),
    prisma.teamMember.findMany({
      where: {
        status: TeamMemberStatus.ACTIVE,
        team: {
          status: TeamStatus.ACTIVE,
          site: {
            status: SiteStatus.ACTIVE,
          },
        },
        user: {
          isActive: true,
        },
      },
      select: {
        assignmentDate: true,
        userId: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
        team: {
          select: {
            site: {
              select: alertSiteSelect,
            },
          },
        },
      },
      orderBy: [{ assignmentDate: 'asc' }, { id: 'asc' }],
    }),
    prisma.clockInRecord.findMany({
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
      },
      orderBy: [
        { userId: 'asc' },
        { siteId: 'asc' },
        { timestampLocal: 'asc' },
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      select: {
        id: true,
        siteId: true,
        userId: true,
        type: true,
        status: true,
        timestampLocal: true,
        distanceToSite: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
        site: {
          select: {
            id: true,
            name: true,
            projectId: true,
            project: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const lastPresenceBySiteId = new Map<string, Date>();
  const lastPresenceByUserAndSiteId = new Map<string, Date>();

  for (const record of lastPresenceRecords) {
    if (!lastPresenceBySiteId.has(record.siteId)) {
      lastPresenceBySiteId.set(record.siteId, record.timestampLocal);
    }

    const key = `${record.userId}:${record.siteId}`;
    if (!lastPresenceByUserAndSiteId.has(key)) {
      lastPresenceByUserAndSiteId.set(key, record.timestampLocal);
    }
  }

  const sitesWithoutPresence = activeSites
    .filter((site) => {
      const lastPresenceAt = lastPresenceBySiteId.get(site.id);
      return !lastPresenceAt || lastPresenceAt.getTime() < sitePresenceThreshold.getTime();
    })
    .map((site) => ({
      siteId: site.id,
      siteName: site.name,
      projectId: site.projectId,
      projectName: site.project.name,
      lastPresenceAt: lastPresenceBySiteId.get(site.id)?.toISOString() ?? null,
    }));

  const openSessions = buildOpenSessions(allRelevantRecords, incompleteThreshold);

  const absentResources = activeMemberships
    .map((membership) => {
      const key = `${membership.userId}:${membership.team.site.id}`;
      const lastPresenceAt = lastPresenceByUserAndSiteId.get(key) ?? null;
      const referenceDate = lastPresenceAt ?? membership.assignmentDate;
      const workingDaysAbsent = countWorkedDaysSince(referenceDate, now);

      return {
        siteId: membership.team.site.id,
        siteName: membership.team.site.name,
        projectId: membership.team.site.projectId,
        projectName: membership.team.site.project.name,
        userId: membership.user.id,
        firstName: membership.user.firstName,
        lastName: membership.user.lastName,
        role: membership.user.role,
        lastPresenceAt: lastPresenceAt?.toISOString() ?? null,
        workingDaysAbsent,
      };
    })
    .filter((item) => item.workingDaysAbsent > 2)
    .sort(compareAbsentResources);

  return {
    sitesWithoutPresence: sitesWithoutPresence.sort(compareSiteWithoutPresence),
    incompleteSessions: openSessions.sort(compareIncompleteSessions),
    absentResources,
  };
}

async function countCompleteSessionsInRange(
  prisma: PrismaClient,
  from: Date,
  to: Date,
  projectIds: string[] | null,
) {
  const sessions = await getCompleteSessionsForRange(prisma, from, to, projectIds);
  return sessions.length;
}

async function getCompleteSessionsForRange(
  prisma: PrismaClient,
  from: Date,
  to: Date,
  projectIds: string[] | null,
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
        gte: from,
        lte: to,
      },
      ...(projectIds
        ? {
            site: {
              projectId: {
                in: projectIds,
              },
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
    select: {
      id: true,
      siteId: true,
      userId: true,
      type: true,
      status: true,
      timestampLocal: true,
      distanceToSite: true,
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
        },
      },
      site: {
        select: {
          id: true,
          name: true,
          projectId: true,
          project: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  return buildSessions(records).filter((session) => !session.incomplete);
}

function buildSessions(records: SessionSourceRecord[]) {
  const sessions: BuiltSession[] = [];
  const states = new Map<
    string,
    { arrival: SessionSourceRecord | null; activePauseStartedAt: Date | null; accumulatedPauseMs: number }
  >();

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

function buildOpenSessions(records: SessionSourceRecord[], threshold: Date) {
  return buildSessions(records)
    .filter((session) => session.incomplete && session.startedAt.getTime() < threshold.getTime())
    .map((session) => ({
      siteId: session.siteId,
      siteName: session.siteName,
      projectId: session.projectId,
      projectName: session.projectName,
      userId: session.userId,
      firstName: session.firstName,
      lastName: session.lastName,
      role: session.role,
      openedAt: session.startedAt.toISOString(),
      hoursOpen: round2((Date.now() - session.startedAt.getTime()) / (60 * 60 * 1000)),
    }));
}

function buildCompleteSession(
  arrival: SessionSourceRecord,
  departure: SessionSourceRecord,
  accumulatedPauseMs: number,
): BuiltSession {
  const durationMs = Math.max(0, departure.timestampLocal.getTime() - arrival.timestampLocal.getTime());

  return {
    siteId: arrival.siteId,
    siteName: arrival.site.name,
    projectId: arrival.site.projectId,
    projectName: arrival.site.project.name,
    userId: arrival.userId,
    firstName: arrival.user.firstName,
    lastName: arrival.user.lastName,
    role: arrival.user.role,
    startedAt: arrival.timestampLocal,
    arrivalDistanceMeters: Math.round(arrival.distanceToSite.toNumber() * 1000),
    realDurationHours: round2((durationMs - accumulatedPauseMs) / (60 * 60 * 1000)),
    incomplete: false,
  };
}

function buildIncompleteSession(arrival: SessionSourceRecord, accumulatedPauseMs: number): BuiltSession {
  void accumulatedPauseMs;

  return {
    siteId: arrival.siteId,
    siteName: arrival.site.name,
    projectId: arrival.site.projectId,
    projectName: arrival.site.project.name,
    userId: arrival.userId,
    firstName: arrival.user.firstName,
    lastName: arrival.user.lastName,
    role: arrival.user.role,
    startedAt: arrival.timestampLocal,
    arrivalDistanceMeters: Math.round(arrival.distanceToSite.toNumber() * 1000),
    realDurationHours: null,
    incomplete: true,
  };
}

function buildProjectAlertCountMap(alerts: DirectionAlertsResponse) {
  const counts = new Map<string, number>();

  for (const alert of alerts.sitesWithoutPresence) {
    counts.set(alert.projectId, (counts.get(alert.projectId) ?? 0) + 1);
  }

  for (const alert of alerts.incompleteSessions) {
    counts.set(alert.projectId, (counts.get(alert.projectId) ?? 0) + 1);
  }

  for (const alert of alerts.absentResources) {
    counts.set(alert.projectId, (counts.get(alert.projectId) ?? 0) + 1);
  }

  return counts;
}

function serializeDirectionActiveSite(site: SerializableActiveSite): DirectionActiveSiteItem {
  return {
    id: site.id,
    projectId: site.projectId,
    projectName: site.project.name,
    name: site.name,
    address: site.address,
    latitude: site.latitude.toNumber(),
    longitude: site.longitude.toNumber(),
    radiusKm: site.radiusKm.toNumber(),
  };
}

function monthRange(year: number, month: number) {
  return {
    from: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
    to: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
  };
}

function previousMonth(year: number, month: number) {
  if (month === 1) {
    return {
      month: 12,
      year: year - 1,
    };
  }

  return {
    month: month - 1,
    year,
  };
}

function calculateDeltaPercent(currentValue: number, previousValue: number) {
  if (previousValue === 0) {
    return currentValue === 0 ? 0 : null;
  }

  return round2(((currentValue - previousValue) / previousValue) * 100);
}

function countWorkedDaysSince(from: Date, to: Date) {
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  let count = 0;

  start.setUTCDate(start.getUTCDate() + 1);

  while (start.getTime() <= end.getTime()) {
    const day = start.getUTCDay();

    if (day !== 0) {
      count += 1;
    }

    start.setUTCDate(start.getUTCDate() + 1);
  }

  return count;
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

function parseProjectStatus(value: string | null) {
  return value && Object.values(ProjectStatus).includes(value as ProjectStatus)
    ? (value as ProjectStatus)
    : null;
}

function sanitizeString(value: string | null) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function round2(value: number) {
  return Number(value.toFixed(2));
}

function compareSiteWithoutPresence(
  left: DirectionAlertsResponse['sitesWithoutPresence'][number],
  right: DirectionAlertsResponse['sitesWithoutPresence'][number],
) {
  return (
    left.projectName.localeCompare(right.projectName) ||
    left.siteName.localeCompare(right.siteName) ||
    left.siteId.localeCompare(right.siteId)
  );
}

function compareIncompleteSessions(
  left: DirectionAlertsResponse['incompleteSessions'][number],
  right: DirectionAlertsResponse['incompleteSessions'][number],
) {
  return (
    right.hoursOpen - left.hoursOpen ||
    left.projectName.localeCompare(right.projectName) ||
    left.siteName.localeCompare(right.siteName) ||
    left.userId.localeCompare(right.userId)
  );
}

function compareAbsentResources(
  left: DirectionAlertsResponse['absentResources'][number],
  right: DirectionAlertsResponse['absentResources'][number],
) {
  return (
    right.workingDaysAbsent - left.workingDaysAbsent ||
    left.projectName.localeCompare(right.projectName) ||
    left.siteName.localeCompare(right.siteName) ||
    left.userId.localeCompare(right.userId)
  );
}
