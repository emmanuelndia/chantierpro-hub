import { ProjectStatus, Role, SiteStatus, TeamMemberStatus, TeamStatus, type PrismaClient } from '@prisma/client';
import { createInternalPhotoUrl } from '@/lib/photos';
import { projectAccessWhere } from '@/lib/projects';
import type {
  MobileProjectDetailPhoto,
  MobileProjectDetailReport,
  MobileProjectDetailResponse,
  MobileProjectDetailSite,
  MobileProjectDetailTeam,
  MobileProjectListItem,
  MobileProjectsResponse,
  MobileProjectStatusFilter,
} from '@/types/mobile-projects';

type AuthLikeUser = {
  id: string;
  role: Role;
};

type MobileProjectsFilters = {
  q?: string | null;
  status?: MobileProjectStatusFilter | null;
};

type ProjectRow = {
  id: string;
  name: string;
  description: string;
  address: string;
  city: string;
  status: ProjectStatus;
  startDate: Date;
  endDate: Date | null;
  createdAt: Date;
  projectManagerId: string;
  projectManager: {
    firstName: string;
    lastName: string;
  };
  sites: {
    status: SiteStatus;
    _count: {
      teams: number;
      photos: number;
      reports: number;
    };
  }[];
};

type ProjectDetailRow = {
  id: string;
  name: string;
  description: string;
  address: string;
  city: string;
  status: ProjectStatus;
  startDate: Date;
  endDate: Date | null;
  createdAt: Date;
  projectManagerId: string;
  projectManager: {
    firstName: string;
    lastName: string;
  };
  sites: {
    id: string;
    name: string;
    address: string;
    status: SiteStatus;
    startDate: Date;
    endDate: Date | null;
    teams: {
      id: string;
      name: string;
      teamLead: {
        firstName: string;
        lastName: string;
      };
      members: {
        userId: string;
        user: {
          firstName: string;
          lastName: string;
          role: Role;
        };
      }[];
    }[];
    _count: {
      photos: number;
      reports: number;
    };
  }[];
};

const MOBILE_PROJECT_ROLES: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION];

export function canAccessMobileProjects(role: Role) {
  return MOBILE_PROJECT_ROLES.includes(role);
}

export async function getMobileProjects(
  prisma: PrismaClient,
  user: AuthLikeUser,
  filters: MobileProjectsFilters = {},
): Promise<MobileProjectsResponse> {
  if (!canAccessMobileProjects(user.role)) {
    return {
      generatedAt: new Date().toISOString(),
      widgets: buildWidgets([]),
      projects: [],
    };
  }

  const now = new Date();
  const status = normalizeStatus(filters.status ?? null);
  const projects = await prisma.project.findMany({
    where: {
      ...(user.role === Role.PROJECT_MANAGER ? { projectManagerId: user.id } : {}),
      ...(status ? { status } : {}),
      ...(filters.q?.trim()
        ? {
            OR: [
              { name: { contains: filters.q.trim(), mode: 'insensitive' } },
              { city: { contains: filters.q.trim(), mode: 'insensitive' } },
              { address: { contains: filters.q.trim(), mode: 'insensitive' } },
              {
                projectManager: {
                  OR: [
                    { firstName: { contains: filters.q.trim(), mode: 'insensitive' } },
                    { lastName: { contains: filters.q.trim(), mode: 'insensitive' } },
                  ],
                },
              },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      description: true,
      address: true,
      city: true,
      status: true,
      startDate: true,
      endDate: true,
      createdAt: true,
      projectManagerId: true,
      projectManager: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
      sites: {
        select: {
          status: true,
          _count: {
            select: {
              teams: true,
              photos: true,
              reports: true,
            },
          },
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  const items = projects.map(serializeProject);

  return {
    generatedAt: now.toISOString(),
    widgets: buildWidgets(items),
    projects: items,
  };
}

export async function getMobileProjectDetail(
  prisma: PrismaClient,
  user: AuthLikeUser,
  projectId: string,
): Promise<MobileProjectDetailResponse | null> {
  if (!canAccessMobileProjects(user.role)) {
    return null;
  }

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ...projectAccessWhere(user),
    },
    select: {
      id: true,
      name: true,
      description: true,
      address: true,
      city: true,
      status: true,
      startDate: true,
      endDate: true,
      createdAt: true,
      projectManagerId: true,
      projectManager: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
      sites: {
        orderBy: [{ status: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          address: true,
          status: true,
          startDate: true,
          endDate: true,
          teams: {
            where: {
              status: TeamStatus.ACTIVE,
            },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              name: true,
              teamLead: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
              members: {
                where: {
                  status: TeamMemberStatus.ACTIVE,
                  user: {
                    isActive: true,
                  },
                },
                orderBy: [{ user: { firstName: 'asc' } }, { user: { lastName: 'asc' } }, { userId: 'asc' }],
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
          _count: {
            select: {
              photos: true,
              reports: true,
            },
          },
        },
      },
    },
  });

  if (!project) {
    return null;
  }

  const siteIds = project.sites.map((site) => site.id);
  const [photosCount, reportsCount, photos, reports] = await Promise.all([
    prisma.photo.count({
      where: {
        isDeleted: false,
        siteId: {
          in: siteIds,
        },
      },
    }),
    prisma.report.count({
      where: {
        siteId: {
          in: siteIds,
        },
      },
    }),
    prisma.photo.findMany({
      where: {
        isDeleted: false,
        siteId: {
          in: siteIds,
        },
      },
      orderBy: [{ timestampLocal: 'desc' }, { id: 'desc' }],
      take: 8,
      select: {
        id: true,
        siteId: true,
        filename: true,
        timestampLocal: true,
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
    }),
    prisma.report.findMany({
      where: {
        siteId: {
          in: siteIds,
        },
      },
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: 8,
      select: {
        id: true,
        siteId: true,
        content: true,
        submittedAt: true,
        validationStatus: true,
        site: {
          select: {
            name: true,
          },
        },
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    }),
  ]);

  const resourceIds = new Set<string>();
  for (const site of project.sites) {
    for (const team of site.teams) {
      for (const member of team.members) {
        resourceIds.add(member.userId);
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    project: serializeProjectDetailHeader(project, photosCount, reportsCount),
    kpis: {
      activeSites: project.sites.filter((site) => site.status === SiteStatus.ACTIVE).length,
      resources: resourceIds.size,
      photos: photosCount,
      reports: reportsCount,
    },
    sites: serializeDetailSites(project),
    teams: serializeDetailTeams(project),
    photos: photos.map(serializeDetailPhoto),
    reports: reports.map(serializeDetailReport),
  };
}

function serializeProject(project: ProjectRow): MobileProjectListItem {
  const sitesCount = project.sites.length;
  const activeSitesCount = project.sites.filter((site) => site.status === SiteStatus.ACTIVE).length;
  const completedSitesCount = project.sites.filter((site) => site.status === SiteStatus.COMPLETED).length;
  const teamsCount = project.sites.reduce((total, site) => total + site._count.teams, 0);
  const photosCount = project.sites.reduce((total, site) => total + site._count.photos, 0);
  const reportsCount = project.sites.reduce((total, site) => total + site._count.reports, 0);
  const progressPercent = calculateProgress(project.status, sitesCount, completedSitesCount);

  return {
    id: project.id,
    name: project.name,
    description: project.description,
    address: project.address,
    city: project.city,
    status: project.status,
    startDate: project.startDate.toISOString(),
    endDate: project.endDate?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    projectManagerId: project.projectManagerId,
    projectManagerName: `${project.projectManager.firstName} ${project.projectManager.lastName}`,
    sitesCount,
    activeSitesCount,
    completedSitesCount,
    teamsCount,
    photosCount,
    reportsCount,
    progressPercent,
    hasAlert: project.status === ProjectStatus.ON_HOLD || (project.status === ProjectStatus.IN_PROGRESS && activeSitesCount === 0),
  };
}

function serializeProjectDetailHeader(
  project: ProjectDetailRow,
  photosCount: number,
  reportsCount: number,
): MobileProjectListItem {
  const sitesCount = project.sites.length;
  const activeSitesCount = project.sites.filter((site) => site.status === SiteStatus.ACTIVE).length;
  const completedSitesCount = project.sites.filter((site) => site.status === SiteStatus.COMPLETED).length;
  const teamsCount = project.sites.reduce((total, site) => total + site.teams.length, 0);

  return {
    id: project.id,
    name: project.name,
    description: project.description,
    address: project.address,
    city: project.city,
    status: project.status,
    startDate: project.startDate.toISOString(),
    endDate: project.endDate?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
    projectManagerId: project.projectManagerId,
    projectManagerName: `${project.projectManager.firstName} ${project.projectManager.lastName}`,
    sitesCount,
    activeSitesCount,
    completedSitesCount,
    teamsCount,
    photosCount,
    reportsCount,
    progressPercent: calculateProgress(project.status, sitesCount, completedSitesCount),
    hasAlert: project.status === ProjectStatus.ON_HOLD || (project.status === ProjectStatus.IN_PROGRESS && activeSitesCount === 0),
  };
}

function serializeDetailSites(project: ProjectDetailRow): MobileProjectDetailSite[] {
  return project.sites.map((site) => {
    const resourceIds = new Set<string>();

    for (const team of site.teams) {
      for (const member of team.members) {
        resourceIds.add(member.userId);
      }
    }

    return {
      id: site.id,
      name: site.name,
      address: site.address,
      status: site.status,
      startDate: site.startDate.toISOString(),
      endDate: site.endDate?.toISOString() ?? null,
      teamsCount: site.teams.length,
      resourcesCount: resourceIds.size,
      photosCount: site._count.photos,
      reportsCount: site._count.reports,
    };
  });
}

function serializeDetailTeams(project: ProjectDetailRow): MobileProjectDetailTeam[] {
  return project.sites.flatMap((site) =>
    site.teams.map((team) => ({
      id: team.id,
      name: team.name,
      siteId: site.id,
      siteName: site.name,
      teamLeadName: `${team.teamLead.firstName} ${team.teamLead.lastName}`,
      membersCount: team.members.length,
      members: team.members.map((member) => ({
        id: member.userId,
        name: `${member.user.firstName} ${member.user.lastName}`,
        role: member.user.role,
      })),
    })),
  );
}

function serializeDetailPhoto(photo: {
  id: string;
  siteId: string;
  filename: string;
  timestampLocal: Date;
  site: {
    name: string;
  };
  uploadedBy: {
    firstName: string;
    lastName: string;
  };
}): MobileProjectDetailPhoto {
  return {
    id: photo.id,
    siteId: photo.siteId,
    siteName: photo.site.name,
    filename: photo.filename,
    url: createInternalPhotoUrl(photo.id),
    uploadedByName: `${photo.uploadedBy.firstName} ${photo.uploadedBy.lastName}`,
    createdAt: photo.timestampLocal.toISOString(),
  };
}

function serializeDetailReport(report: {
  id: string;
  siteId: string;
  content: string;
  submittedAt: Date;
  validationStatus: MobileProjectDetailReport['validationStatus'];
  site: {
    name: string;
  };
  user: {
    firstName: string;
    lastName: string;
  };
}): MobileProjectDetailReport {
  return {
    id: report.id,
    siteId: report.siteId,
    siteName: report.site.name,
    authorName: `${report.user.firstName} ${report.user.lastName}`,
    submittedAt: report.submittedAt.toISOString(),
    validationStatus: report.validationStatus,
    content: report.content,
  };
}

function calculateProgress(status: ProjectStatus, sitesCount: number, completedSitesCount: number) {
  if (status === ProjectStatus.COMPLETED) {
    return 100;
  }

  if (sitesCount === 0) {
    return 0;
  }

  return Math.round((completedSitesCount / sitesCount) * 100);
}

function buildWidgets(projects: MobileProjectListItem[]) {
  return [
    {
      id: 'total' as const,
      label: 'Total',
      value: projects.length,
      helper: 'projets visibles',
    },
    {
      id: 'active' as const,
      label: 'Actifs',
      value: projects.filter((project) => project.status === ProjectStatus.IN_PROGRESS).length,
      helper: 'en cours',
    },
    {
      id: 'completed' as const,
      label: 'Terminés',
      value: projects.filter((project) => project.status === ProjectStatus.COMPLETED).length,
      helper: 'clôturés',
    },
    {
      id: 'alerts' as const,
      label: 'Alertes',
      value: projects.filter((project) => project.hasAlert).length,
      helper: 'à surveiller',
    },
  ];
}

function normalizeStatus(status: MobileProjectStatusFilter | null) {
  if (!status || status === 'ALL') {
    return null;
  }

  return status;
}
