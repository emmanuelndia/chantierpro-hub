import { Role, SiteStatus, TeamMemberStatus, TeamStatus, type Prisma, type PrismaClient } from '@prisma/client';
import { projectAccessWhere, serializeSite, sitePublicSelect } from '@/lib/projects';
import { listProjectFormOptions } from '@/lib/project-web';
import type {
  MobileSiteFormOptionsResponse,
  MobileSiteManagementItem,
  MobileSitesManagementResponse,
  MobileSiteStatusFilter,
} from '@/types/mobile-sites';
import type { SiteDetail } from '@/types/projects';

type AuthLikeUser = {
  id: string;
  role: Role;
};

type MobileSitesFilters = {
  projectId?: string | null;
  status?: MobileSiteStatusFilter | null;
  q?: string | null;
};

type SiteManagementRow = {
  id: string;
  projectId: string;
  name: string;
  address: string;
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
  radiusKm: Prisma.Decimal;
  status: SiteStatus;
  startDate: Date;
  endDate: Date | null;
  project: {
    id: string;
    name: string;
  };
  teams: {
    members: {
      userId: string;
    }[];
  }[];
  _count: {
    photos: number;
    clockInRecords: number;
  };
};

const MOBILE_SITE_MANAGEMENT_ROLES: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION];

export function canAccessMobileSitesManagement(role: Role) {
  return MOBILE_SITE_MANAGEMENT_ROLES.includes(role);
}

export async function getMobileSitesManagement(
  prisma: PrismaClient,
  user: AuthLikeUser,
  filters: MobileSitesFilters = {},
): Promise<MobileSitesManagementResponse> {
  if (!canAccessMobileSitesManagement(user.role)) {
    return {
      generatedAt: new Date().toISOString(),
      widgets: buildWidgets([]),
      projects: [],
      sites: [],
    };
  }

  const status = normalizeStatus(filters.status ?? null);
  const query = filters.q?.trim() ?? '';
  const projectWhere = projectAccessWhere(user);
  const rawProjectId = filters.projectId?.trim() ?? '';
  const projectId = rawProjectId ? rawProjectId : null;

  const where: Prisma.SiteWhereInput = {
    project: projectWhere,
    ...(projectId ? { projectId } : {}),
    ...(status ? { status } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { address: { contains: query, mode: 'insensitive' } },
            {
              project: {
                is: {
                  ...projectWhere,
                  name: { contains: query, mode: 'insensitive' },
                },
              },
            },
          ],
        }
      : {}),
  };

  const [sites, projects] = await Promise.all([
    prisma.site.findMany({
      where,
      orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        projectId: true,
        name: true,
        address: true,
        latitude: true,
        longitude: true,
        radiusKm: true,
        status: true,
        startDate: true,
        endDate: true,
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
              },
            },
          },
        },
        _count: {
          select: {
            photos: {
              where: {
                isDeleted: false,
              },
            },
            clockInRecords: true,
          },
        },
      },
    }),
    prisma.project.findMany({
      where: projectWhere,
      select: {
        id: true,
        name: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
  ]);

  const items = sites.map(serializeManagementSite);

  return {
    generatedAt: new Date().toISOString(),
    widgets: buildWidgets(items),
    projects,
    sites: items,
  };
}

export async function getMobileSiteFormOptions(
  prisma: PrismaClient,
  user: AuthLikeUser,
): Promise<MobileSiteFormOptionsResponse> {
  const [projects, options] = await Promise.all([
    prisma.project.findMany({
      where: projectAccessWhere(user),
      select: {
        id: true,
        name: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    listProjectFormOptions(prisma, user),
  ]);

  return {
    projects,
    siteManagers: options.siteManagers,
  };
}

export async function getMobileSiteForm(
  prisma: PrismaClient,
  user: AuthLikeUser,
  siteId: string,
): Promise<{ site: SiteDetail; options: MobileSiteFormOptionsResponse } | null> {
  if (!canAccessMobileSitesManagement(user.role)) {
    return null;
  }

  const site = await prisma.site.findFirst({
    where: {
      id: siteId,
      project: projectAccessWhere(user),
    },
    select: sitePublicSelect,
  });

  if (!site) {
    return null;
  }

  return {
    site: serializeSite(site),
    options: await getMobileSiteFormOptions(prisma, user),
  };
}

function serializeManagementSite(site: SiteManagementRow): MobileSiteManagementItem {
  const resourceIds = new Set<string>();

  for (const team of site.teams) {
    for (const member of team.members) {
      resourceIds.add(member.userId);
    }
  }

  return {
    id: site.id,
    projectId: site.projectId,
    name: site.name,
    address: site.address,
    status: site.status,
    latitude: site.latitude.toNumber(),
    longitude: site.longitude.toNumber(),
    radiusKm: site.radiusKm.toNumber(),
    startDate: site.startDate.toISOString(),
    endDate: site.endDate?.toISOString() ?? null,
    project: site.project,
    teamsCount: site.teams.length,
    resourcesCount: resourceIds.size,
    photosCount: site._count.photos,
    clockInRecordsCount: site._count.clockInRecords,
  };
}

function buildWidgets(sites: MobileSiteManagementItem[]) {
  return {
    total: sites.length,
    active: sites.filter((site) => site.status === SiteStatus.ACTIVE).length,
    onHold: sites.filter((site) => site.status === SiteStatus.ON_HOLD).length,
    completed: sites.filter((site) => site.status === SiteStatus.COMPLETED).length,
  };
}

function normalizeStatus(status: MobileSiteStatusFilter | null) {
  if (!status || status === 'ALL') {
    return null;
  }

  return status;
}
