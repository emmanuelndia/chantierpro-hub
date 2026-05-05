import {
  ClockInStatus,
  ClockInType,
  Role,
  SiteStatus,
  TeamMemberStatus,
  TeamStatus,
  type PrismaClient,
} from '@prisma/client';
import { createInternalPhotoUrl } from '@/lib/photos';
import type {
  MobileManagementAlertItem,
  MobileManagementDashboardResponse,
  MobileManagementPhotoItem,
  MobileManagementSiteItem,
} from '@/types/mobile-management';

type AuthLikeUser = {
  id: string;
  role: Role;
};

type SiteRow = {
  id: string;
  projectId: string;
  name: string;
  status: SiteStatus;
  project: {
    name: string;
  };
  teams: {
    members: {
      userId: string;
    }[];
  }[];
  clockInRecords: {
    userId: string;
    type: ClockInType;
    timestampLocal: Date;
  }[];
};

const MOBILE_MANAGEMENT_ROLES: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION];

export function canAccessMobileManagementDashboard(role: Role) {
  return MOBILE_MANAGEMENT_ROLES.includes(role);
}

export async function getMobileManagementDashboard(
  prisma: PrismaClient,
  user: AuthLikeUser,
): Promise<MobileManagementDashboardResponse> {
  const now = new Date();
  const today = toDateOnlyDate(now);
  const siteWhere =
    user.role === Role.PROJECT_MANAGER
      ? {
          status: SiteStatus.ACTIVE,
          project: {
            projectManagerId: user.id,
          },
        }
      : {
          status: SiteStatus.ACTIVE,
        };

  const sites = await prisma.site.findMany({
    where: siteWhere,
    select: {
      id: true,
      projectId: true,
      name: true,
      status: true,
      project: {
        select: {
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
            },
          },
        },
      },
      clockInRecords: {
        where: {
          status: ClockInStatus.VALID,
        },
        orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: {
          userId: true,
          type: true,
          timestampLocal: true,
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  const siteIds = sites.map((site) => site.id);
  const [photos, incompleteAlerts] = await Promise.all([
    prisma.photo.findMany({
      where: {
        isDeleted: false,
        siteId: {
          in: siteIds,
        },
      },
      orderBy: [{ timestampLocal: 'desc' }, { id: 'desc' }],
      take: 4,
      select: {
        id: true,
        siteId: true,
        filename: true,
        storageKey: true,
        timestampLocal: true,
        site: {
          select: {
            name: true,
          },
        },
      },
    }),
    findIncompleteSessionAlerts(prisma, siteIds, now),
  ]);

  const siteItems = sites.map((site) => serializeSiteItem(site, today));
  const noPresenceAlerts = buildNoPresenceAlerts(sites, now);
  const alerts = [...noPresenceAlerts, ...incompleteAlerts].sort(compareAlerts);
  const presentResources = countScopedPresentUsers(sites, today);
  const totalResources = countScopedResourceUsers(sites);

  return {
    generatedAt: now.toISOString(),
    widgets: [
      {
        id: 'present',
        label: 'Presents',
        value: presentResources,
        helper: 'ressources sur site',
      },
      {
        id: 'resources',
        label: 'Ressources',
        value: totalResources,
        helper: 'affectees actives',
      },
      {
        id: 'sites',
        label: 'Sites actifs',
        value: siteItems.length,
        helper: 'chantiers ouverts',
      },
      {
        id: 'alerts',
        label: 'Alertes',
        value: alerts.length,
        helper: 'a traiter',
      },
    ],
    sites: siteItems,
    alerts,
    latestPhotos: photos.map(serializePhotoItem),
  };
}

function serializeSiteItem(site: SiteRow, today: Date): MobileManagementSiteItem {
  const activeResourceIds = new Set<string>();

  for (const team of site.teams) {
    for (const member of team.members) {
      activeResourceIds.add(member.userId);
    }
  }

  return {
    id: site.id,
    projectId: site.projectId,
    projectName: site.project.name,
    name: site.name,
    status: site.status,
    presentCount: getPresentUserIds(site.clockInRecords.filter((record) => sameDateOnly(record.timestampLocal, today))).size,
    totalResources: activeResourceIds.size,
    lastClockInAt: site.clockInRecords.at(-1)?.timestampLocal.toISOString() ?? null,
  };
}

function buildNoPresenceAlerts(sites: SiteRow[], now: Date): MobileManagementAlertItem[] {
  const threshold = now.getTime() - 2 * 24 * 60 * 60 * 1000;

  return sites
    .map((site) => {
      const lastClockInAt = site.clockInRecords.at(-1)?.timestampLocal ?? null;

      return {
        site,
        lastClockInAt,
      };
    })
    .filter((item) => !item.lastClockInAt || item.lastClockInAt.getTime() < threshold)
    .map(({ site, lastClockInAt }) => ({
      id: `no-presence:${site.id}`,
      type: 'NO_PRESENCE_2D' as const,
      siteId: site.id,
      siteName: site.name,
      projectName: site.project.name,
      title: 'Site sans presence',
      description: lastClockInAt
        ? `Aucune presence depuis ${formatRelativeDays(lastClockInAt, now)}.`
        : 'Aucune presence valide enregistree.',
      occurredAt: lastClockInAt?.toISOString() ?? null,
    }));
}

async function findIncompleteSessionAlerts(
  prisma: PrismaClient,
  siteIds: string[],
  now: Date,
): Promise<MobileManagementAlertItem[]> {
  if (siteIds.length === 0) {
    return [];
  }

  const records = await prisma.clockInRecord.findMany({
    where: {
      status: ClockInStatus.VALID,
      siteId: {
        in: siteIds,
      },
      type: {
        in: [ClockInType.ARRIVAL, ClockInType.DEPARTURE],
      },
    },
    orderBy: [{ userId: 'asc' }, { siteId: 'asc' }, { timestampLocal: 'asc' }, { id: 'asc' }],
    select: {
      siteId: true,
      userId: true,
      type: true,
      timestampLocal: true,
      site: {
        select: {
          name: true,
          project: {
            select: {
              name: true,
            },
          },
        },
      },
      user: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  const openByUserSite = new Map<string, (typeof records)[number]>();

  for (const record of records) {
    const key = `${record.userId}:${record.siteId}`;

    if (record.type === ClockInType.ARRIVAL) {
      openByUserSite.set(key, record);
      continue;
    }

    if (record.type === ClockInType.DEPARTURE) {
      openByUserSite.delete(key);
    }
  }

  const threshold = now.getTime() - 12 * 60 * 60 * 1000;

  return [...openByUserSite.values()]
    .filter((record) => record.timestampLocal.getTime() < threshold)
    .map((record) => ({
      id: `incomplete:${record.userId}:${record.siteId}`,
      type: 'INCOMPLETE_SESSION_12H' as const,
      siteId: record.siteId,
      siteName: record.site.name,
      projectName: record.site.project.name,
      title: 'Session incomplete',
      description: `${record.user.firstName} ${record.user.lastName} pointe depuis ${formatHours(record.timestampLocal, now)}.`,
      occurredAt: record.timestampLocal.toISOString(),
    }));
}

function countScopedResourceUsers(sites: SiteRow[]) {
  const userIds = new Set<string>();

  for (const site of sites) {
    for (const team of site.teams) {
      for (const member of team.members) {
        userIds.add(member.userId);
      }
    }
  }

  return userIds.size;
}

function countScopedPresentUsers(sites: SiteRow[], today: Date) {
  const userIds = new Set<string>();

  for (const site of sites) {
    for (const userId of getPresentUserIds(
      site.clockInRecords.filter((record) => sameDateOnly(record.timestampLocal, today)),
    )) {
      userIds.add(userId);
    }
  }

  return userIds.size;
}

function getPresentUserIds(records: { userId: string; type: ClockInType }[]) {
  const present = new Set<string>();

  for (const record of records) {
    if (record.type === ClockInType.ARRIVAL || record.type === ClockInType.INTERMEDIATE) {
      present.add(record.userId);
      continue;
    }

    if (record.type === ClockInType.DEPARTURE) {
      present.delete(record.userId);
    }
  }

  return present;
}

function serializePhotoItem(photo: {
  id: string;
  siteId: string;
  filename: string;
  storageKey: string;
  timestampLocal: Date;
  site: {
    name: string;
  };
}): MobileManagementPhotoItem {
  return {
    id: photo.id,
    siteId: photo.siteId,
    siteName: photo.site.name,
    filename: photo.filename,
    createdAt: photo.timestampLocal.toISOString(),
    url: createInternalPhotoUrl(photo.id),
  };
}

function compareAlerts(left: MobileManagementAlertItem, right: MobileManagementAlertItem) {
  return (
    alertRank(left.type) - alertRank(right.type) ||
    left.projectName.localeCompare(right.projectName) ||
    left.siteName.localeCompare(right.siteName)
  );
}

function alertRank(type: MobileManagementAlertItem['type']) {
  return type === 'INCOMPLETE_SESSION_12H' ? 0 : 1;
}

function formatRelativeDays(from: Date, to: Date) {
  const days = Math.max(1, Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
  return `${days} j`;
}

function formatHours(from: Date, to: Date) {
  const hours = Math.max(0, Math.floor((to.getTime() - from.getTime()) / (60 * 60 * 1000)));
  return `${hours} h`;
}

function sameDateOnly(value: Date, dateOnly: Date) {
  return toDateOnlyDate(value).getTime() === dateOnly.getTime();
}

function toDateOnlyDate(value: Date) {
  return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}
