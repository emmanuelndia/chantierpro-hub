import { ClockInStatus, ClockInType, Prisma, ProjectStatus, Role, TeamMemberStatus, TeamStatus, type PrismaClient } from '@prisma/client';
import { createInternalPhotoUrl } from '@/lib/photos';
import { getScopedProjectById, getScopedSiteById, projectAccessWhere, projectPublicSelect, serializeProject, serializeProjectDetail } from '@/lib/projects';
import type {
  GeocodingSearchResponse,
  PaginatedProjectsResponse,
  PaginatedSitePresencesResponse,
  ProjectFormOptionsResponse,
  ProjectPhotoItem,
  ProjectPhotosResponse,
  ProjectTeamSummaryItem,
  ProjectTeamSummaryResponse,
  SitePresenceRow,
  SitePresenceRowStatus,
} from '@/types/projects';

export const PROJECTS_PAGE_SIZE = 25;
export const SITE_PRESENCES_PAGE_SIZE = 25;

type AuthLikeUser = {
  id: string;
  role: Role;
};

type ProjectListQuery = {
  page: number;
  search: string | null;
  status: ProjectStatus | null;
  periodFrom: string | null;
  periodTo: string | null;
};

type SitePresencesQuery = {
  page: number;
  from: string | null;
  to: string | null;
  userIds: string[];
  type: ClockInType | null;
};

type PresenceRecord = {
  id: string;
  userId: string;
  type: ClockInType;
  status: ClockInStatus;
  timestampLocal: Date;
  distanceToSite: Prisma.Decimal;
  comment: string | null;
  user: {
    firstName: string;
    lastName: string;
  };
};

type SessionState = {
  arrival: PresenceRecord | null;
  activePauseStartedAt: Date | null;
  accumulatedPauseMs: number;
  hasAnomaly: boolean;
  types: Set<ClockInType>;
  comments: string[];
};

export function parseProjectListQuery(searchParams: URLSearchParams): ProjectListQuery | null {
  const page = parsePositiveInteger(searchParams.get('page')) ?? 1;
  const search = sanitizeString(searchParams.get('search'));
  const status = parseProjectStatus(searchParams.get('status'));
  const periodFrom = sanitizeDateOnly(searchParams.get('periodFrom'));
  const periodTo = sanitizeDateOnly(searchParams.get('periodTo'));

  if (searchParams.get('page') !== null && page < 1) {
    return null;
  }

  if ((searchParams.get('periodFrom') && !periodFrom) || (searchParams.get('periodTo') && !periodTo)) {
    return null;
  }

  if (periodFrom && periodTo && new Date(periodFrom).getTime() > new Date(periodTo).getTime()) {
    return null;
  }

  return {
    page,
    search,
    status,
    periodFrom,
    periodTo,
  };
}

export async function listProjectsPage(
  prisma: PrismaClient,
  user: AuthLikeUser,
  query: ProjectListQuery,
): Promise<PaginatedProjectsResponse> {
  const where: Prisma.ProjectWhereInput = {
    ...projectAccessWhere(user),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { city: { contains: query.search, mode: 'insensitive' } },
            { address: { contains: query.search, mode: 'insensitive' } },
            { description: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...buildProjectPeriodWhere(query.periodFrom, query.periodTo),
  };

  const [items, totalItems] = await prisma.$transaction([
    prisma.project.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * PROJECTS_PAGE_SIZE,
      take: PROJECTS_PAGE_SIZE,
      select: projectPublicSelect,
    }),
    prisma.project.count({ where }),
  ]);

  const projectIds = items.map((item) => item.id);
  const memberships = projectIds.length
    ? await prisma.teamMember.findMany({
        where: {
          status: TeamMemberStatus.ACTIVE,
          team: {
            status: TeamStatus.ACTIVE,
            site: {
              projectId: {
                in: projectIds,
              },
            },
          },
        },
        select: {
          userId: true,
          team: {
            select: {
              site: {
                select: {
                  projectId: true,
                },
              },
            },
          },
        },
      })
    : [];

  const resourcesByProject = new Map<string, Set<string>>();
  for (const membership of memberships) {
    const projectId = membership.team.site.projectId;
    const existing = resourcesByProject.get(projectId) ?? new Set<string>();
    existing.add(membership.userId);
    resourcesByProject.set(projectId, existing);
  }

  const serialized = items.map((item) => ({
    ...serializeProject(item),
    resourcesCount: resourcesByProject.get(item.id)?.size ?? 0,
  }));

  return {
    items: serialized,
    page: query.page,
    pageSize: PROJECTS_PAGE_SIZE,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / PROJECTS_PAGE_SIZE)),
  };
}

export async function getProjectDetailForWeb(
  prisma: PrismaClient,
  projectId: string,
  user: AuthLikeUser,
) {
  const project = await getScopedProjectById(prisma, projectId, user);
  if (!project) {
    return null;
  }

  const memberships = await prisma.teamMember.findMany({
    where: {
      status: TeamMemberStatus.ACTIVE,
      team: {
        status: TeamStatus.ACTIVE,
        site: {
          projectId,
        },
      },
    },
    select: {
      userId: true,
    },
  });

  const uniqueUsers = new Set(memberships.map((item) => item.userId));

  return {
    ...serializeProjectDetail(project),
    resourcesCount: uniqueUsers.size,
  };
}

export async function listProjectFormOptions(
  prisma: PrismaClient,
  user: AuthLikeUser,
): Promise<ProjectFormOptionsResponse> {
  const [projectManagers, siteManagers] = await Promise.all([
    prisma.user.findMany({
      where:
        user.role === Role.PROJECT_MANAGER
          ? {
              id: user.id,
              isActive: true,
            }
          : {
              role: Role.PROJECT_MANAGER,
              isActive: true,
            },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
      select: userOptionSelect,
    }),
    prisma.user.findMany({
      where: {
        isActive: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
      select: userOptionSelect,
    }),
  ]);

  return {
    projectManagers: projectManagers.map(serializeUserOption),
    siteManagers: siteManagers.map(serializeUserOption),
  };
}

export async function getProjectTeamSummary(
  prisma: PrismaClient,
  projectId: string,
  user: AuthLikeUser,
): Promise<ProjectTeamSummaryResponse | null> {
  const project = await getScopedProjectById(prisma, projectId, user);
  if (!project) {
    return null;
  }

  const memberships = await prisma.teamMember.findMany({
    where: {
      status: TeamMemberStatus.ACTIVE,
      team: {
        status: TeamStatus.ACTIVE,
        site: {
          projectId,
        },
      },
    },
    orderBy: [{ user: { firstName: 'asc' } }, { user: { lastName: 'asc' } }, { id: 'asc' }],
    select: {
      userId: true,
      user: {
        select: userOptionSelect,
      },
      team: {
        select: {
          id: true,
          name: true,
          site: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  const currentMonth = new Date();
  const sessions = await getBuiltSessionsForScope(prisma, {
    projectId,
    siteId: null,
    from: monthStart(currentMonth),
    to: monthEnd(currentMonth),
    userIds: [],
  });

  const hoursByUser = new Map<string, number>();
  for (const session of sessions) {
    if (session.realDurationMinutes !== null) {
      hoursByUser.set(
        session.userId,
        round2((hoursByUser.get(session.userId) ?? 0) + session.realDurationMinutes / 60),
      );
    }
  }

  const grouped = new Map<string, ProjectTeamSummaryItem>();
  const teamsCount = new Set<string>();

  for (const membership of memberships) {
    teamsCount.add(membership.team.id);
    const current = grouped.get(membership.userId) ?? {
      userId: membership.userId,
      firstName: membership.user.firstName,
      lastName: membership.user.lastName,
      email: membership.user.email,
      role: membership.user.role,
      contact: membership.user.contact,
      teamNames: [],
      siteNames: [],
      hoursThisMonth: hoursByUser.get(membership.userId) ?? 0,
    };

    if (!current.teamNames.includes(membership.team.name)) {
      current.teamNames.push(membership.team.name);
    }

    if (!current.siteNames.includes(membership.team.site.name)) {
      current.siteNames.push(membership.team.site.name);
    }

    grouped.set(membership.userId, current);
  }

  const items = [...grouped.values()].sort(
    (left, right) =>
      left.lastName.localeCompare(right.lastName) ||
      left.firstName.localeCompare(right.firstName) ||
      left.userId.localeCompare(right.userId),
  );

  return {
    projectId,
    month: currentMonth.getUTCMonth() + 1,
    year: currentMonth.getUTCFullYear(),
    teamsCount: teamsCount.size,
    resourcesCount: items.length,
    items,
  };
}

export async function getProjectPhotos(
  prisma: PrismaClient,
  projectId: string,
  user: AuthLikeUser,
): Promise<ProjectPhotosResponse | null> {
  const project = await getScopedProjectById(prisma, projectId, user);
  if (!project) {
    return null;
  }

  const photos = await prisma.photo.findMany({
    where: {
      isDeleted: false,
      site: {
        projectId,
      },
    },
    orderBy: [{ timestampLocal: 'desc' }, { id: 'desc' }],
    take: 24,
    select: {
      id: true,
      siteId: true,
      category: true,
      description: true,
      filename: true,
      storageKey: true,
      createdAt: true,
      site: {
        select: {
          name: true,
        },
      },
      uploadedBy: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  const items: ProjectPhotoItem[] = photos.map((photo) => ({
      id: photo.id,
      siteId: photo.siteId,
      siteName: photo.site.name,
      uploadedByName: `${photo.uploadedBy.firstName} ${photo.uploadedBy.lastName}`,
      category: photo.category,
      description: photo.description,
      filename: photo.filename,
      url: createInternalPhotoUrl(photo.id),
      createdAt: photo.createdAt.toISOString(),
    }));

  return {
    projectId,
    items,
  };
}

export function parseSitePresencesQuery(searchParams: URLSearchParams): SitePresencesQuery | null {
  const page = parsePositiveInteger(searchParams.get('page')) ?? 1;
  const from = sanitizeDateOnly(searchParams.get('from'));
  const to = sanitizeDateOnly(searchParams.get('to'));
  const type = parseClockInType(searchParams.get('type'));
  const userIds = (searchParams.get('userIds') ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if ((searchParams.get('from') && !from) || (searchParams.get('to') && !to)) {
    return null;
  }

  if (searchParams.get('type') && !type) {
    return null;
  }

  if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
    return null;
  }

  return {
    page,
    from,
    to,
    userIds,
    type,
  };
}

export async function getSitePresences(
  prisma: PrismaClient,
  siteId: string,
  user: AuthLikeUser,
  query: SitePresencesQuery,
): Promise<PaginatedSitePresencesResponse | null> {
  const site = await getScopedSiteById(prisma, siteId, user);
  if (!site) {
    return null;
  }

  const sessions = await getBuiltSessionsForScope(prisma, {
    projectId: null,
    siteId,
    from: query.from ? new Date(`${query.from}T00:00:00.000Z`) : new Date('2000-01-01T00:00:00.000Z'),
    to: query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date('2100-12-31T23:59:59.999Z'),
    userIds: query.userIds,
  });

  const requestedType = query.type;
  const filtered = requestedType
    ? sessions.filter((session) => session.types.includes(requestedType))
    : sessions;

  const totalItems = filtered.length;
  const pagedItems = filtered.slice(
    (query.page - 1) * SITE_PRESENCES_PAGE_SIZE,
    query.page * SITE_PRESENCES_PAGE_SIZE,
  );

  return {
    siteId,
    page: query.page,
    pageSize: SITE_PRESENCES_PAGE_SIZE,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / SITE_PRESENCES_PAGE_SIZE)),
    items: pagedItems,
  };
}

export async function buildSitePresencesCsv(
  prisma: PrismaClient,
  siteId: string,
  user: AuthLikeUser,
  query: SitePresencesQuery,
) {
  const site = await getScopedSiteById(prisma, siteId, user);
  if (!site) {
    return null;
  }

  const sessions = await getBuiltSessionsForScope(prisma, {
    projectId: null,
    siteId,
    from: query.from ? new Date(`${query.from}T00:00:00.000Z`) : new Date('2000-01-01T00:00:00.000Z'),
    to: query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date('2100-12-31T23:59:59.999Z'),
    userIds: query.userIds,
  });

  const requestedType = query.type;
  const filtered = requestedType
    ? sessions.filter((session) => session.types.includes(requestedType))
    : sessions;

  const header = [
    'Ressource',
    'Date',
    'Arrivee',
    'Depart',
    'Pauses (min)',
    'Duree reelle (min)',
    'Distance (m)',
    'Statut',
    'Commentaire',
  ];

  const lines = [
    header.join(','),
    ...filtered.map((item) =>
      [
        item.resourceName,
        item.date,
        item.arrivalTime ?? '',
        item.departureTime ?? '',
        String(item.pauseDurationMinutes),
        item.realDurationMinutes === null ? '' : String(item.realDurationMinutes),
        String(item.distanceMeters),
        item.status,
        item.comment ?? '',
      ]
        .map(escapeCsvValue)
        .join(','),
    ),
  ];

  return {
    fileName: `site-presences-${site.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`,
    buffer: Buffer.from(`\uFEFF${lines.join('\r\n')}`, 'utf8'),
  };
}

export async function searchMapboxAddress(query: string): Promise<GeocodingSearchResponse> {
  const token = process.env.MAPBOX_ACCESS_TOKEN;
  if (!token) {
    return { items: [] };
  }

  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`);
  url.searchParams.set('access_token', token);
  url.searchParams.set('autocomplete', 'true');
  url.searchParams.set('limit', '6');
  url.searchParams.set('language', 'fr');

  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    return { items: [] };
  }

  const payload = (await response.json()) as {
    features?: {
      place_name?: string;
      center?: [number, number];
    }[];
  };

  return {
    items:
      payload.features
        ?.filter((feature) => feature.place_name && Array.isArray(feature.center) && feature.center.length === 2)
        .map((feature) => ({
          label: feature.place_name ?? '',
          latitude: feature.center?.[1] ?? 0,
          longitude: feature.center?.[0] ?? 0,
        })) ?? [],
  };
}

const userOptionSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  contact: true,
} satisfies Prisma.UserSelect;

function serializeUserOption(user: Prisma.UserGetPayload<{ select: typeof userOptionSelect }>) {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    contact: user.contact,
  };
}

function buildProjectPeriodWhere(periodFrom: string | null, periodTo: string | null): Prisma.ProjectWhereInput {
  if (!periodFrom && !periodTo) {
    return {};
  }

  const andClauses: Prisma.ProjectWhereInput[] = [];

  if (periodTo) {
    andClauses.push({
      startDate: {
        lte: new Date(`${periodTo}T23:59:59.999Z`),
      },
    });
  }

  if (periodFrom) {
    andClauses.push({
      OR: [
        {
          endDate: null,
        },
        {
          endDate: {
            gte: new Date(`${periodFrom}T00:00:00.000Z`),
          },
        },
      ],
    });
  }

  return andClauses.length > 0 ? { AND: andClauses } : {};
}

async function getBuiltSessionsForScope(
  prisma: PrismaClient,
  payload: {
    projectId: string | null;
    siteId: string | null;
    from: Date;
    to: Date;
    userIds: string[];
  },
) {
  const records = await prisma.clockInRecord.findMany({
    where: {
      timestampLocal: {
        gte: payload.from,
        lte: payload.to,
      },
      ...(payload.projectId
        ? {
            site: {
              projectId: payload.projectId,
            },
          }
        : {}),
      ...(payload.siteId
        ? {
            siteId: payload.siteId,
          }
        : {}),
      ...(payload.userIds.length > 0
        ? {
            userId: {
              in: payload.userIds,
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
      userId: true,
      type: true,
      status: true,
      timestampLocal: true,
      distanceToSite: true,
      comment: true,
      user: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  return buildPresenceRows(records).sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      left.resourceName.localeCompare(right.resourceName) ||
      left.id.localeCompare(right.id),
  );
}

function buildPresenceRows(records: PresenceRecord[]): SitePresenceRow[] {
  const sessions: SitePresenceRow[] = [];
  const states = new Map<string, SessionState>();

  for (const record of records) {
    const key = record.userId;
    const state = states.get(key) ?? {
      arrival: null,
      activePauseStartedAt: null,
      accumulatedPauseMs: 0,
      hasAnomaly: false,
      types: new Set<ClockInType>(),
      comments: [],
    };

    state.types.add(record.type);
    if (record.comment) {
      state.comments.push(record.comment);
    }
    if (record.status === ClockInStatus.ANOMALY) {
      state.hasAnomaly = true;
    }

    if (record.type === ClockInType.ARRIVAL) {
      if (state.arrival) {
        sessions.push(buildPresenceRow(state.arrival, null, state.accumulatedPauseMs, state.hasAnomaly, state.types, state.comments));
      }

      states.set(key, {
        arrival: record,
        activePauseStartedAt: null,
        accumulatedPauseMs: 0,
        hasAnomaly: record.status === ClockInStatus.ANOMALY,
        types: new Set([record.type]),
        comments: record.comment ? [record.comment] : [],
      });
      continue;
    }

    if (!state.arrival) {
      states.set(key, state);
      continue;
    }

    if (record.type === ClockInType.PAUSE_START) {
      state.activePauseStartedAt ??= record.timestampLocal;
      states.set(key, state);
      continue;
    }

    if (record.type === ClockInType.PAUSE_END) {
      if (state.activePauseStartedAt) {
        state.accumulatedPauseMs += Math.max(0, record.timestampLocal.getTime() - state.activePauseStartedAt.getTime());
        state.activePauseStartedAt = null;
      }
      states.set(key, state);
      continue;
    }

    if (record.type === ClockInType.DEPARTURE) {
      sessions.push(buildPresenceRow(state.arrival, record, state.accumulatedPauseMs, state.hasAnomaly || record.status === ClockInStatus.ANOMALY, state.types, state.comments));
      states.set(key, {
        arrival: null,
        activePauseStartedAt: null,
        accumulatedPauseMs: 0,
        hasAnomaly: false,
        types: new Set<ClockInType>(),
        comments: [],
      });
      continue;
    }

    states.set(key, state);
  }

  for (const state of states.values()) {
    if (state.arrival) {
      sessions.push(buildPresenceRow(state.arrival, null, state.accumulatedPauseMs, state.hasAnomaly, state.types, state.comments));
    }
  }

  return sessions;
}

function buildPresenceRow(
  arrival: PresenceRecord,
  departure: PresenceRecord | null,
  accumulatedPauseMs: number,
  hasAnomaly: boolean,
  types: Set<ClockInType>,
  comments: string[],
): SitePresenceRow {
  const grossDurationMs = departure ? Math.max(0, departure.timestampLocal.getTime() - arrival.timestampLocal.getTime()) : null;
  const realDurationMinutes = grossDurationMs === null ? null : Math.max(0, Math.round((grossDurationMs - accumulatedPauseMs) / 60000));
  const status: SitePresenceRowStatus = hasAnomaly ? 'ANOMALY' : departure ? 'COMPLETE' : 'INCOMPLETE';

  return {
    id: departure ? `${arrival.id}:${departure.id}` : arrival.id,
    userId: arrival.userId,
    resourceName: `${arrival.user.firstName} ${arrival.user.lastName}`,
    date: arrival.timestampLocal.toISOString().slice(0, 10),
    arrivalTime: arrival.timestampLocal.toISOString().slice(11, 19),
    departureTime: departure?.timestampLocal.toISOString().slice(11, 19) ?? null,
    pauseDurationMinutes: Math.round(accumulatedPauseMs / 60000),
    realDurationMinutes,
    distanceMeters: Math.round(arrival.distanceToSite.toNumber() * 1000),
    status,
    comment: comments.at(-1) ?? null,
    types: [...types],
  };
}

function monthStart(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function monthEnd(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function parsePositiveInteger(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : -1;
}

function sanitizeString(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeDateOnly(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : value;
}

function parseProjectStatus(value: string | null) {
  return value && Object.values(ProjectStatus).includes(value as ProjectStatus)
    ? (value as ProjectStatus)
    : null;
}

function parseClockInType(value: string | null) {
  return value && Object.values(ClockInType).includes(value as ClockInType)
    ? (value as ClockInType)
    : null;
}

function escapeCsvValue(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function round2(value: number) {
  return Number(value.toFixed(2));
}
