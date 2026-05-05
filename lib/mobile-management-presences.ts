import {
  ClockInStatus,
  ClockInType,
  Role,
  SiteStatus,
  TeamMemberStatus,
  TeamStatus,
  type PrismaClient,
} from '@prisma/client';
import type {
  MobileManagementPresenceResource,
  MobileManagementPresenceSite,
  MobileManagementPresenceStatus,
  MobileManagementPresencesProject,
  MobileManagementPresencesResponse,
} from '@/types/mobile-management-presences';

type AuthLikeUser = {
  id: string;
  role: Role;
};

type PresenceFilterStatus = 'present' | 'paused' | 'alerts';

type MobileManagementPresencesFilters = {
  projectId?: string | null;
  status?: PresenceFilterStatus | null;
  q?: string | null;
};

type PresenceRecord = {
  userId: string;
  type: ClockInType;
  status: ClockInStatus;
  timestampLocal: Date;
};

type SiteRow = {
  id: string;
  projectId: string;
  name: string;
  status: SiteStatus;
  project: {
    id: string;
    name: string;
  };
  teams: {
    members: {
      userId: string;
      user: {
        firstName: string;
        lastName: string;
        role: Role;
      };
    }[];
  }[];
  clockInRecords: PresenceRecord[];
};

const MOBILE_MANAGEMENT_PRESENCES_ROLES: readonly Role[] = [
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
];

export function canAccessMobileManagementPresences(role: Role) {
  return MOBILE_MANAGEMENT_PRESENCES_ROLES.includes(role);
}

export async function getMobileManagementPresences(
  prisma: PrismaClient,
  user: AuthLikeUser,
  filters: MobileManagementPresencesFilters = {},
): Promise<MobileManagementPresencesResponse> {
  if (!canAccessMobileManagementPresences(user.role)) {
    return {
      generatedAt: new Date().toISOString(),
      widgets: buildWidgets([]),
      projects: [],
      sites: [],
    };
  }

  const now = new Date();
  const today = toDateOnlyDate(now);
  const siteWhere = {
    status: SiteStatus.ACTIVE,
    ...(user.role === Role.PROJECT_MANAGER
      ? {
          project: {
            projectManagerId: user.id,
          },
        }
      : {}),
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
  };

  const [projectOptions, sites] = await Promise.all([
    getScopedProjects(prisma, user),
    prisma.site.findMany({
      where: siteWhere,
      select: {
        id: true,
        projectId: true,
        name: true,
        status: true,
        project: {
          select: {
            id: true,
            name: true,
          },
        },
        teams: {
          where: {
            status: TeamStatus.ACTIVE,
          },
          select: {
            members: {
              where: {
                status: TeamMemberStatus.ACTIVE,
                user: {
                  isActive: true,
                },
              },
              select: {
                userId: true,
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                    role: true,
                  },
                },
              },
            },
          },
        },
        clockInRecords: {
          where: {
            clockInDate: today,
            status: ClockInStatus.VALID,
          },
          orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          select: {
            userId: true,
            type: true,
            status: true,
            timestampLocal: true,
          },
        },
      },
      orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
    }),
  ]);

  const query = normalizeSearch(filters.q);
  const siteItems = sites
    .map(serializeSite)
    .filter((site) => matchesSearch(site, query))
    .filter((site) => matchesStatus(site, filters.status ?? null));

  return {
    generatedAt: now.toISOString(),
    widgets: buildWidgets(siteItems),
    projects: projectOptions,
    sites: siteItems,
  };
}

async function getScopedProjects(
  prisma: PrismaClient,
  user: AuthLikeUser,
): Promise<MobileManagementPresencesProject[]> {
  const projects = await prisma.project.findMany({
    where: {
      ...(user.role === Role.PROJECT_MANAGER ? { projectManagerId: user.id } : {}),
      sites: {
        some: {
          status: SiteStatus.ACTIVE,
        },
      },
    },
    select: {
      id: true,
      name: true,
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });

  return projects;
}

function serializeSite(site: SiteRow): MobileManagementPresenceSite {
  const resources = serializeResources(site);

  return {
    id: site.id,
    projectId: site.projectId,
    projectName: site.project.name,
    name: site.name,
    status: site.status,
    presentCount: resources.filter((resource) => resource.status === 'PRESENT').length,
    pausedCount: resources.filter((resource) => resource.status === 'PAUSED').length,
    absentCount: resources.filter((resource) => resource.status === 'ABSENT').length,
    totalResources: resources.length,
    lastClockInAt: site.clockInRecords.at(-1)?.timestampLocal.toISOString() ?? null,
    resources,
  };
}

function serializeResources(site: SiteRow): MobileManagementPresenceResource[] {
  const uniqueMembers = new Map<string, SiteRow['teams'][number]['members'][number]>();

  for (const team of site.teams) {
    for (const member of team.members) {
      uniqueMembers.set(member.userId, member);
    }
  }

  return [...uniqueMembers.values()]
    .map((member) => {
      const records = site.clockInRecords.filter((record) => record.userId === member.userId);
      const state = getPresenceState(records);

      return {
        userId: member.userId,
        name: `${member.user.firstName} ${member.user.lastName}`,
        role: member.user.role,
        status: state.status,
        presentSince: state.presentSince?.toISOString() ?? null,
        pauseSince: state.pauseSince?.toISOString() ?? null,
        lastClockInAt: records.at(-1)?.timestampLocal.toISOString() ?? null,
      };
    })
    .sort(compareResources);
}

function getPresenceState(records: PresenceRecord[]): {
  status: MobileManagementPresenceStatus;
  presentSince: Date | null;
  pauseSince: Date | null;
} {
  let presentSince: Date | null = null;
  let pauseSince: Date | null = null;

  for (const record of records) {
    if (record.type === ClockInType.ARRIVAL || record.type === ClockInType.INTERMEDIATE) {
      presentSince = record.timestampLocal;
      pauseSince = null;
      continue;
    }

    if (record.type === ClockInType.DEPARTURE) {
      presentSince = null;
      pauseSince = null;
      continue;
    }

    if (record.type === ClockInType.PAUSE_START && presentSince) {
      pauseSince = record.timestampLocal;
      continue;
    }

    if (record.type === ClockInType.PAUSE_END) {
      pauseSince = null;
    }
  }

  if (pauseSince) {
    return {
      status: 'PAUSED',
      presentSince,
      pauseSince,
    };
  }

  if (presentSince) {
    return {
      status: 'PRESENT',
      presentSince,
      pauseSince: null,
    };
  }

  return {
    status: 'ABSENT',
    presentSince: null,
    pauseSince: null,
  };
}

function matchesSearch(site: MobileManagementPresenceSite, query: string | null) {
  if (!query) {
    return true;
  }

  return (
    site.name.toLowerCase().includes(query) ||
    site.projectName.toLowerCase().includes(query) ||
    site.resources.some((resource) => resource.name.toLowerCase().includes(query))
  );
}

function matchesStatus(site: MobileManagementPresenceSite, status: PresenceFilterStatus | null) {
  if (!status) {
    return true;
  }

  if (status === 'present') {
    return site.presentCount > 0;
  }

  if (status === 'paused') {
    return site.pausedCount > 0;
  }

  return site.presentCount === 0;
}

function buildWidgets(sites: MobileManagementPresenceSite[]) {
  const present = sites.reduce((total, site) => total + site.presentCount, 0);
  const paused = sites.reduce((total, site) => total + site.pausedCount, 0);
  const absent = sites.reduce((total, site) => total + site.absentCount, 0);

  return [
    {
      id: 'present' as const,
      label: 'Présents',
      value: present,
      helper: 'ressources sur site',
    },
    {
      id: 'paused' as const,
      label: 'En pause',
      value: paused,
      helper: 'pauses actives',
    },
    {
      id: 'absent' as const,
      label: 'Absents',
      value: absent,
      helper: 'ressources attendues',
    },
    {
      id: 'activeSites' as const,
      label: 'Chantiers actifs',
      value: sites.length,
      helper: 'dans le périmètre',
    },
  ];
}

function compareResources(
  left: MobileManagementPresenceResource,
  right: MobileManagementPresenceResource,
) {
  return presenceRank(left.status) - presenceRank(right.status) || left.name.localeCompare(right.name);
}

function presenceRank(status: MobileManagementPresenceStatus) {
  if (status === 'PRESENT') {
    return 0;
  }

  if (status === 'PAUSED') {
    return 1;
  }

  return 2;
}

function normalizeSearch(value?: string | null) {
  const trimmed = value?.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  return trimmed;
}

function toDateOnlyDate(value: Date) {
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}
