import { Prisma, ProjectStatus, Role, SiteStatus, type PrismaClient } from '@prisma/client';
import type { SiteMapResponse, SiteMapSiteItem } from '@/types/site-map';

type AuthLikeUser = {
  id: string;
  role: Role;
};

type SiteMapFilters = {
  projectId?: string | null;
  projectManagerId?: string | null;
  q?: string | null;
  status?: SiteStatus | null;
};

type SiteMapRow = {
  id: string;
  name: string;
  address: string;
  siteType: import('@prisma/client').SiteType;
  status: SiteStatus;
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
  radiusKm: Prisma.Decimal;
  project: {
    id: string;
    name: string;
    city: string;
    projectManager: {
      id: string;
      firstName: string;
      lastName: string;
    };
  };
};

const SITE_MAP_ROLES: readonly Role[] = [Role.AUDITOR, Role.PROJECT_MANAGER, Role.HR, Role.DIRECTION, Role.ADMIN];

export function canAccessSiteMap(role: Role) {
  return SITE_MAP_ROLES.includes(role);
}

export async function getSiteMapData(
  prisma: PrismaClient,
  user: AuthLikeUser,
  filters: SiteMapFilters = {},
): Promise<SiteMapResponse> {
  if (!canAccessSiteMap(user.role)) {
    return emptyResponse(user.role);
  }

  const query = filters.q?.trim() ?? '';
  const projectId = sanitizeOptionalFilter(filters.projectId);
  const projectManagerId = user.role === Role.PROJECT_MANAGER ? user.id : sanitizeOptionalFilter(filters.projectManagerId);
  const projectWhere: Prisma.ProjectWhereInput = {
    status: ProjectStatus.IN_PROGRESS,
    ...(user.role === Role.PROJECT_MANAGER ? { projectManagerId: user.id } : {}),
    ...(projectId ? { id: projectId } : {}),
    ...(projectManagerId ? { projectManagerId } : {}),
  };

  const where: Prisma.SiteWhereInput = {
    project: projectWhere,
    ...(filters.status ? { status: filters.status } : {}),
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
            {
              project: {
                is: {
                  ...projectWhere,
                  city: { contains: query, mode: 'insensitive' },
                },
              },
            },
            {
              project: {
                is: {
                  ...projectWhere,
                  projectManager: {
                    OR: [
                      { firstName: { contains: query, mode: 'insensitive' } },
                      { lastName: { contains: query, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            },
          ],
        }
      : {}),
  };

  const [sites, projects, projectManagers] = await Promise.all([
    prisma.site.findMany({
      where,
      orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        address: true,
        siteType: true,
        status: true,
        latitude: true,
        longitude: true,
        radiusKm: true,
        project: {
          select: {
            id: true,
            name: true,
            city: true,
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
    }),
    prisma.project.findMany({
      where: {
        status: ProjectStatus.IN_PROGRESS,
        ...(user.role === Role.PROJECT_MANAGER ? { projectManagerId: user.id } : {}),
      },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }),
    prisma.user.findMany({
      where: {
        role: Role.PROJECT_MANAGER,
        isActive: true,
        managedProjects: {
          some: {
            status: ProjectStatus.IN_PROGRESS,
            ...(user.role === Role.PROJECT_MANAGER ? { projectManagerId: user.id } : {}),
          },
        },
      },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
    }),
  ]);

  const mappedSites = sites.map(serializeSite);
  const visibleSites = mappedSites.filter((site) => hasUsableCoordinates(site.latitude, site.longitude));

  return {
    generatedAt: new Date().toISOString(),
    viewer: {
      role: user.role,
      canLogVisit: user.role === Role.AUDITOR,
      canFilterProjectManager: user.role !== Role.PROJECT_MANAGER,
    },
    filters: {
      projects,
      projectManagers: projectManagers.map((manager) => ({
        id: manager.id,
        name: `${manager.firstName} ${manager.lastName}`,
      })),
    },
    totals: {
      sites: visibleSites.length,
      hiddenWithoutCoordinates: mappedSites.length - visibleSites.length,
    },
    sites: visibleSites,
  };
}

function emptyResponse(role: Role): SiteMapResponse {
  return {
    generatedAt: new Date().toISOString(),
    viewer: {
      role,
      canLogVisit: false,
      canFilterProjectManager: false,
    },
    filters: {
      projects: [],
      projectManagers: [],
    },
    totals: {
      sites: 0,
      hiddenWithoutCoordinates: 0,
    },
    sites: [],
  };
}

function serializeSite(site: SiteMapRow): SiteMapSiteItem {
  return {
    id: site.id,
    name: site.name,
    address: site.address,
    siteType: site.siteType,
    status: site.status,
    latitude: site.latitude.toNumber(),
    longitude: site.longitude.toNumber(),
    radiusKm: site.radiusKm.toNumber(),
    project: {
      id: site.project.id,
      name: site.project.name,
      city: site.project.city,
    },
    projectManager: {
      id: site.project.projectManager.id,
      name: `${site.project.projectManager.firstName} ${site.project.projectManager.lastName}`,
    },
  };
}

function hasUsableCoordinates(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    (Math.abs(latitude) > 0.01 || Math.abs(longitude) > 0.01)
  );
}
function sanitizeOptionalFilter(value: string | null | undefined) {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}