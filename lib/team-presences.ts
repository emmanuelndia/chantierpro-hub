import {
  ClockInStatus,
  ClockInType,
  Role,
  TeamMemberStatus,
  TeamStatus,
  type PrismaClient,
} from '@prisma/client';
import { getOperationalSiteIds } from '@/lib/dashboard';
import type {
  TeamPresenceItem,
  TeamPresencesApiErrorCode,
  TeamPresencesResponse,
  TeamPresenceStatusFilter,
  TeamPresenceTimelineItem,
} from '@/types/team-presences';

const TEAM_PRESENCE_ROLES: readonly Role[] = [
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
  Role.ADMIN,
];

type AuthLikeUser = {
  id: string;
  role: Role;
};

type TeamPresenceQuery = {
  date: Date;
  dateLabel: string;
  siteId: string | null;
  status: TeamPresenceStatusFilter;
};

type SupervisorRow = {
  id: string;
  firstName: string;
  lastName: string;
  teamMemberships: {
    team: {
      site: {
        id: string;
        name: string;
      };
    };
  }[];
};

type PresenceRecord = {
  id: string;
  userId: string;
  siteId: string;
  type: ClockInType;
  timestampLocal: Date;
  comment: string | null;
  site: {
    name: string;
  };
  report: {
    id: string;
    submittedAt: Date;
  } | null;
};

type ReportFallback = {
  id: string;
  userId: string;
  siteId: string;
  submittedAt: Date;
};

export function canAccessTeamPresences(role: Role) {
  return TEAM_PRESENCE_ROLES.includes(role);
}

export function jsonTeamPresencesError(
  code: TeamPresencesApiErrorCode,
  status: number,
  message: string,
) {
  return Response.json({ code, message }, { status });
}

export function parseTeamPresencesQuery(searchParams: URLSearchParams): TeamPresenceQuery | null {
  const rawDate = searchParams.get('date')?.trim();
  const dateLabel = rawDate && rawDate.length > 0 ? rawDate : new Date().toISOString().slice(0, 10);
  const date = parseDateOnly(dateLabel);
  const status = parseStatus(searchParams.get('status'));
  const siteId = sanitizeString(searchParams.get('siteId'));

  if (!date || !status) {
    return null;
  }

  return {
    date,
    dateLabel,
    siteId,
    status,
  };
}

export async function getTeamPresences(
  prisma: PrismaClient,
  user: AuthLikeUser,
  query: TeamPresenceQuery,
): Promise<TeamPresencesResponse> {
  const now = new Date();
  const allSiteIds = await getScopedTeamPresenceSiteIds(prisma, user);
  const scopedSiteIds = query.siteId ? allSiteIds.filter((siteId) => siteId === query.siteId) : allSiteIds;
  const day = dayRange(query.date);

  const [sites, supervisors, records, fallbackReports] = await Promise.all([
    prisma.site.findMany({
      where: {
        id: {
          in: allSiteIds,
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
      },
    }),
    findScopedSupervisors(prisma, scopedSiteIds),
    prisma.clockInRecord.findMany({
      where: {
        status: ClockInStatus.VALID,
        clockInDate: query.date,
        siteId: {
          in: scopedSiteIds,
        },
        user: {
          role: Role.SUPERVISOR,
          isActive: true,
        },
      },
      orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        userId: true,
        siteId: true,
        type: true,
        timestampLocal: true,
        comment: true,
        site: {
          select: {
            name: true,
          },
        },
        report: {
          select: {
            id: true,
            submittedAt: true,
          },
        },
      },
    }),
    prisma.report.findMany({
      where: {
        submittedAt: {
          gte: day.from,
          lte: day.to,
        },
        siteId: {
          in: scopedSiteIds,
        },
        user: {
          role: Role.SUPERVISOR,
          isActive: true,
        },
      },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        userId: true,
        siteId: true,
        submittedAt: true,
      },
    }),
  ]);

  const recordsBySupervisor = groupRecordsBySupervisor(records);
  const reportsBySupervisorSite = groupReportsBySupervisorSite(fallbackReports);
  const presentNow: TeamPresenceItem[] = [];
  const onPause: TeamPresenceItem[] = [];
  const departedToday: TeamPresenceItem[] = [];
  const absent: TeamPresenceItem[] = [];

  for (const supervisor of supervisors) {
    const supervisorRecords = recordsBySupervisor.get(supervisor.id) ?? [];
    const item = buildSupervisorPresenceItem(supervisor, supervisorRecords, reportsBySupervisorSite, now);

    if (item.kind === 'present') {
      presentNow.push(item.item);
      continue;
    }

    if (item.kind === 'paused') {
      onPause.push(item.item);
      continue;
    }

    if (item.kind === 'departed') {
      departedToday.push(item.item);
      continue;
    }

    absent.push(item.item);
  }

  return filterResponseByStatus(
    {
      date: query.dateLabel,
      generatedAt: now.toISOString(),
      sites,
      presentNow: sortBySupervisorName(presentNow),
      onPause: sortBySupervisorName(onPause),
      departedToday: sortBySupervisorName(departedToday),
      absent: sortBySupervisorName(absent),
    },
    query.status,
  );
}

async function getScopedTeamPresenceSiteIds(prisma: PrismaClient, user: AuthLikeUser) {
  if (user.role === Role.COORDINATOR || user.role === Role.GENERAL_SUPERVISOR) {
    return getOperationalSiteIds(prisma, user.id);
  }

  const sites = await prisma.site.findMany({
    where:
      user.role === Role.PROJECT_MANAGER
        ? {
            project: {
              projectManagerId: user.id,
            },
          }
        : {},
    select: {
      id: true,
    },
  });

  return sites.map((site) => site.id);
}

async function findScopedSupervisors(prisma: PrismaClient, siteIds: string[]) {
  if (siteIds.length === 0) {
    return [];
  }

  return prisma.user.findMany({
    where: {
      role: Role.SUPERVISOR,
      isActive: true,
      OR: [
        {
          teamMemberships: {
            some: {
              status: TeamMemberStatus.ACTIVE,
              team: {
                status: TeamStatus.ACTIVE,
                siteId: {
                  in: siteIds,
                },
              },
            },
          },
        },
        {
          clockInRecords: {
            some: {
              siteId: {
                in: siteIds,
              },
            },
          },
        },
        {
          reports: {
            some: {
              siteId: {
                in: siteIds,
              },
            },
          },
        },
      ],
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      teamMemberships: {
        where: {
          status: TeamMemberStatus.ACTIVE,
          team: {
            status: TeamStatus.ACTIVE,
            siteId: {
              in: siteIds,
            },
          },
        },
        take: 1,
        select: {
          team: {
            select: {
              site: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  });
}

function buildSupervisorPresenceItem(
  supervisor: SupervisorRow,
  records: PresenceRecord[],
  fallbackReports: Map<string, ReportFallback>,
  now: Date,
):
  | { kind: 'present'; item: TeamPresenceItem }
  | { kind: 'paused'; item: TeamPresenceItem }
  | { kind: 'departed'; item: TeamPresenceItem }
  | { kind: 'absent'; item: TeamPresenceItem } {
  if (records.length === 0) {
    const site = supervisor.teamMemberships[0]?.team.site ?? { id: 'none', name: 'Aucun chantier' };
    return {
      kind: 'absent',
      item: {
        id: `absent:${supervisor.id}:${site.id}`,
        supervisorId: supervisor.id,
        supervisorName: formatName(supervisor),
        siteId: site.id,
        siteName: site.name,
        arrivalAt: null,
        departureAt: null,
        durationSeconds: null,
        effectiveDurationSeconds: null,
        currentPauseSeconds: null,
        timeline: [],
        report: {
          submitted: false,
          reportId: null,
          submittedAt: null,
        },
      },
    };
  }

  const selectedRecords = selectRelevantSiteRecords(records);
  const timeline = selectedRecords.map(serializeTimelineItem);
  const latestSession = buildLatestSession(selectedRecords);
  const latestRecord = selectedRecords[selectedRecords.length - 1] ?? records[records.length - 1];

  if (!latestRecord) {
    const site = supervisor.teamMemberships[0]?.team.site ?? { id: 'none', name: 'Aucun chantier' };
    return {
      kind: 'absent',
      item: {
        id: `absent:${supervisor.id}:${site.id}`,
        supervisorId: supervisor.id,
        supervisorName: formatName(supervisor),
        siteId: site.id,
        siteName: site.name,
        arrivalAt: null,
        departureAt: null,
        durationSeconds: null,
        effectiveDurationSeconds: null,
        currentPauseSeconds: null,
        timeline: [],
        report: {
          submitted: false,
          reportId: null,
          submittedAt: null,
        },
      },
    };
  }

  const siteId = latestSession?.siteId ?? latestRecord.siteId;
  const siteName = latestSession?.siteName ?? latestRecord.site.name;
  const report = buildReportState(latestSession?.departureRecord ?? null, fallbackReports.get(`${supervisor.id}:${siteId}`) ?? null);
  const base: Omit<TeamPresenceItem, 'id'> = {
    supervisorId: supervisor.id,
    supervisorName: formatName(supervisor),
    siteId,
    siteName,
    arrivalAt: latestSession?.arrivalAt.toISOString() ?? null,
    departureAt: latestSession?.departureAt?.toISOString() ?? null,
    durationSeconds: latestSession ? calculateDurationSeconds(latestSession.arrivalAt, latestSession.departureAt ?? now) : null,
    effectiveDurationSeconds: latestSession
      ? Math.max(0, calculateDurationSeconds(latestSession.arrivalAt, latestSession.departureAt ?? now) - latestSession.pauseSeconds)
      : null,
    currentPauseSeconds: latestSession?.activePauseStartedAt
      ? calculateDurationSeconds(latestSession.activePauseStartedAt, now)
      : null,
    timeline,
    report,
  };

  if (latestSession?.open && latestSession.activePauseStartedAt) {
    return {
      kind: 'paused',
      item: {
        ...base,
        id: `paused:${supervisor.id}:${siteId}`,
      },
    };
  }

  if (latestSession?.open) {
    return {
      kind: 'present',
      item: {
        ...base,
        id: `present:${supervisor.id}:${siteId}`,
      },
    };
  }

  return {
    kind: 'departed',
    item: {
      ...base,
      id: `departed:${supervisor.id}:${siteId}`,
    },
  };
}

function selectRelevantSiteRecords(records: PresenceRecord[]) {
  const latestSessionRecord = [...records]
    .reverse()
    .find((record) => record.type === ClockInType.ARRIVAL || record.type === ClockInType.DEPARTURE);
  const siteId = latestSessionRecord?.siteId ?? records[records.length - 1]?.siteId;

  return records.filter((record) => record.siteId === siteId);
}

function buildLatestSession(records: PresenceRecord[]) {
  let current:
    | {
        siteId: string;
        siteName: string;
        arrivalAt: Date;
        departureAt: Date | null;
        departureRecord: PresenceRecord | null;
        open: boolean;
        pauseSeconds: number;
        activePauseStartedAt: Date | null;
      }
    | null = null;

  for (const record of records) {
    if (record.type === ClockInType.ARRIVAL) {
      current = {
        siteId: record.siteId,
        siteName: record.site.name,
        arrivalAt: record.timestampLocal,
        departureAt: null,
        departureRecord: null,
        open: true,
        pauseSeconds: 0,
        activePauseStartedAt: null,
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (record.type === ClockInType.PAUSE_START && current.open && !current.activePauseStartedAt) {
      current.activePauseStartedAt = record.timestampLocal;
      continue;
    }

    if (record.type === ClockInType.PAUSE_END && current.activePauseStartedAt) {
      current.pauseSeconds += calculateDurationSeconds(current.activePauseStartedAt, record.timestampLocal);
      current.activePauseStartedAt = null;
      continue;
    }

    if (record.type === ClockInType.DEPARTURE) {
      current.departureAt = record.timestampLocal;
      current.departureRecord = record;
      current.open = false;
      current.activePauseStartedAt = null;
    }
  }

  return current;
}

function filterResponseByStatus(response: TeamPresencesResponse, status: TeamPresenceStatusFilter) {
  if (status === 'all') {
    return response;
  }

  return {
    ...response,
    presentNow: status === 'present' ? response.presentNow : [],
    onPause: status === 'paused' ? response.onPause : [],
    departedToday: status === 'departed' ? response.departedToday : [],
    absent: status === 'absent' ? response.absent : [],
  };
}

function buildReportState(departureRecord: PresenceRecord | null, fallbackReport: ReportFallback | null) {
  const report = departureRecord?.report ?? fallbackReport;

  return {
    submitted: Boolean(report),
    reportId: report?.id ?? null,
    submittedAt: report?.submittedAt.toISOString() ?? null,
  };
}

function groupRecordsBySupervisor(records: PresenceRecord[]) {
  const grouped = new Map<string, PresenceRecord[]>();

  for (const record of records) {
    const current = grouped.get(record.userId) ?? [];
    current.push(record);
    grouped.set(record.userId, current);
  }

  return grouped;
}

function groupReportsBySupervisorSite(reports: ReportFallback[]) {
  const grouped = new Map<string, ReportFallback>();

  for (const report of reports) {
    const key = `${report.userId}:${report.siteId}`;
    if (!grouped.has(key)) {
      grouped.set(key, report);
    }
  }

  return grouped;
}

function serializeTimelineItem(record: PresenceRecord): TeamPresenceTimelineItem {
  return {
    id: record.id,
    type: record.type,
    timestampLocal: record.timestampLocal.toISOString(),
    siteId: record.siteId,
    siteName: record.site.name,
    comment: record.comment,
  };
}

function sortBySupervisorName(items: TeamPresenceItem[]) {
  return [...items].sort((left, right) => left.supervisorName.localeCompare(right.supervisorName));
}

function formatName(user: { firstName: string; lastName: string }) {
  return `${user.firstName} ${user.lastName}`.trim();
}

function calculateDurationSeconds(from: Date, to: Date) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 1000));
}

function dayRange(date: Date) {
  return {
    from: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)),
    to: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999)),
  };
}

function parseDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseStatus(value: string | null): TeamPresenceStatusFilter | null {
  if (!value) {
    return 'all';
  }

  return ['all', 'present', 'paused', 'departed', 'absent'].includes(value)
    ? (value as TeamPresenceStatusFilter)
    : null;
}

function sanitizeString(value: string | null) {
  const trimmed = value?.trim();
  return trimmed ?? null;
}
