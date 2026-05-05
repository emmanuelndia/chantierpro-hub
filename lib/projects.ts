import { Prisma, ProjectStatus, Role, SiteStatus, TeamMemberStatus, type PrismaClient } from '@prisma/client';
import type {
  CreateProjectInput,
  CreateSiteInput,
  PresenceWorkerItem,
  ProjectApiErrorCode,
  ProjectDetail,
  ProjectListItem,
  ProjectPresenceSiteItem,
  ProjectPresenceSummary,
  SiteDetail,
  TodaySiteItem,
  UpdateProjectInput,
  UpdateSiteInput,
} from '@/types/projects';

const PROJECT_READ_ROLES: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION, Role.ADMIN];
const PROJECT_WRITE_ROLES: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION, Role.ADMIN];
const GEOFENCING_ROLES: readonly Role[] = [Role.DIRECTION, Role.ADMIN];

export const sitePublicSelect = {
  id: true,
  projectId: true,
  name: true,
  address: true,
  latitude: true,
  longitude: true,
  radiusKm: true,
  description: true,
  status: true,
  area: true,
  startDate: true,
  endDate: true,
  siteManagerId: true,
  createdById: true,
  createdAt: true,
} satisfies Prisma.SiteSelect;

export const projectPublicSelect = {
  id: true,
  name: true,
  description: true,
  address: true,
  city: true,
  startDate: true,
  endDate: true,
  status: true,
  createdAt: true,
  projectManagerId: true,
  createdById: true,
  sites: {
    select: {
      id: true,
      status: true,
      teams: {
        select: {
          members: {
            select: {
              userId: true,
              status: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ProjectSelect;

export const projectDetailSelect = {
  id: true,
  name: true,
  description: true,
  address: true,
  city: true,
  startDate: true,
  endDate: true,
  status: true,
  createdAt: true,
  projectManagerId: true,
  createdById: true,
  sites: {
    select: {
      ...sitePublicSelect,
      teams: {
        select: {
          members: {
            select: {
              userId: true,
              status: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  },
} satisfies Prisma.ProjectSelect;

type SerializableProject = Prisma.ProjectGetPayload<{
  select: typeof projectPublicSelect;
}>;

type SerializableProjectDetail = Prisma.ProjectGetPayload<{
  select: typeof projectDetailSelect;
}>;

type SerializableSite = Prisma.SiteGetPayload<{
  select: typeof sitePublicSelect;
}>;

type AuthLikeUser = {
  id: string;
  role: Role;
};

export function jsonProjectError(
  code: ProjectApiErrorCode,
  status: number,
  message: string,
  extra?: Record<string, boolean | number | string>,
) {
  return Response.json(
    {
      code,
      message,
      ...extra,
    },
    { status },
  );
}

export function canReadProjects(role: Role) {
  return PROJECT_READ_ROLES.includes(role);
}

export function canWriteProjects(role: Role) {
  return PROJECT_WRITE_ROLES.includes(role);
}

export function canManageGeofencing(role: Role) {
  return GEOFENCING_ROLES.includes(role);
}

export function projectAccessWhere(user: AuthLikeUser): Prisma.ProjectWhereInput {
  if (user.role === Role.PROJECT_MANAGER) {
    return {
      projectManagerId: user.id,
    };
  }

  return {};
}

export async function getScopedProjectById(
  prisma: PrismaClient,
  projectId: string,
  user: AuthLikeUser,
) {
  return prisma.project.findFirst({
    where: {
      id: projectId,
      ...projectAccessWhere(user),
    },
    select: projectDetailSelect,
  });
}

export async function getScopedSiteById(
  prisma: PrismaClient,
  siteId: string,
  user: AuthLikeUser,
) {
  return prisma.site.findFirst({
    where: {
      id: siteId,
      project: projectAccessWhere(user),
    },
    select: sitePublicSelect,
  });
}

export function serializeProject(project: SerializableProject): ProjectListItem {
  const sitesCount = project.sites.length;
  const activeSitesCount = project.sites.filter((site) => site.status === SiteStatus.ACTIVE).length;
  const activeResourceIds = new Set<string>();

  for (const site of project.sites) {
    for (const team of site.teams) {
      for (const member of team.members) {
        if (member.status === TeamMemberStatus.ACTIVE) {
          activeResourceIds.add(member.userId);
        }
      }
    }
  }

  return {
    id: project.id,
    name: project.name,
    description: project.description,
    address: project.address,
    city: project.city,
    startDate: project.startDate.toISOString(),
    endDate: project.endDate?.toISOString() ?? null,
    status: project.status,
    createdAt: project.createdAt.toISOString(),
    projectManagerId: project.projectManagerId,
    createdById: project.createdById,
    sitesCount,
    activeSitesCount,
    resourcesCount: activeResourceIds.size,
  };
}

export function serializeSite(site: SerializableSite): SiteDetail {
  return {
    id: site.id,
    projectId: site.projectId,
    name: site.name,
    address: site.address,
    latitude: site.latitude.toNumber(),
    longitude: site.longitude.toNumber(),
    radiusKm: site.radiusKm.toNumber(),
    description: site.description,
    status: site.status,
    area: site.area.toNumber(),
    startDate: site.startDate.toISOString(),
    endDate: site.endDate?.toISOString() ?? null,
    siteManagerId: site.siteManagerId,
    createdById: site.createdById,
    createdAt: site.createdAt.toISOString(),
  };
}

export function serializeProjectDetail(project: SerializableProjectDetail): ProjectDetail {
  return {
    ...serializeProject(project),
    sites: project.sites.map(serializeSite),
  };
}

export async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function parseCreateProjectInput(body: unknown): CreateProjectInput | null {
  if (!isRecord(body)) {
    return null;
  }

  const name = sanitizeProjectName(body.name);
  const description = sanitizeString(body.description);
  const address = sanitizeString(body.address);
  const city = sanitizeString(body.city);
  const projectManagerId = sanitizeString(body.projectManagerId);
  const status = parseProjectStatus(body.status) ?? ProjectStatus.IN_PROGRESS;
  const startDate = sanitizeDateString(body.startDate);
  const endDate = body.endDate === null || body.endDate === undefined ? null : sanitizeDateString(body.endDate);

  if (!name || !description || !address || !city || !projectManagerId || !status || !startDate) {
    return null;
  }

  return {
    name,
    description,
    address,
    city,
    projectManagerId,
    status,
    startDate,
    endDate,
  };
}

export function parseUpdateProjectInput(body: unknown): UpdateProjectInput | null {
  return parseCreateProjectInput(body);
}

export function parseCreateSiteInput(body: unknown): CreateSiteInput | null {
  if (!isRecord(body)) {
    return null;
  }

  const name = sanitizeProjectName(body.name);
  const address = sanitizeString(body.address);
  const description = sanitizeString(body.description);
  const siteManagerId = sanitizeString(body.siteManagerId);
  const startDate = sanitizeDateString(body.startDate);
  const endDate = body.endDate === null || body.endDate === undefined ? null : sanitizeDateString(body.endDate);
  const status = parseSiteStatus(body.status) ?? SiteStatus.ACTIVE;
  const latitude = sanitizeNumber(body.latitude);
  const longitude = sanitizeNumber(body.longitude);
  const area = sanitizeNumber(body.area);
  const radiusKmProvided = body.radiusKm !== undefined && body.radiusKm !== null;
  const radiusKm =
    radiusKmProvided ? sanitizeNumber(body.radiusKm) : 2.0;

  if (
    !name ||
    !address ||
    !description ||
    !siteManagerId ||
    !startDate ||
    !status ||
    latitude === null ||
    longitude === null ||
    area === null ||
    radiusKm === null
  ) {
    return null;
  }

  return {
    name,
    address,
    latitude,
    longitude,
    radiusKm,
    radiusKmProvided,
    description,
    status,
    area,
    startDate,
    endDate,
    siteManagerId,
  };
}

export function parseUpdateSiteInput(body: unknown): UpdateSiteInput | null {
  if (isRecord(body) && 'projectId' in body) {
    return null;
  }

  return parseCreateSiteInput(body);
}

export function validateDateRange(startDate: string, endDate: string | null) {
  if (!endDate) {
    return true;
  }

  return new Date(endDate).getTime() > new Date(startDate).getTime();
}

export function validateRadius(radiusKm: number) {
  return radiusKm >= 0.5 && radiusKm <= 10;
}

export function assertCreateSiteRadiusAllowed(user: AuthLikeUser, input: CreateSiteInput) {
  if (input.radiusKmProvided && !canManageGeofencing(user.role)) {
    return jsonProjectError(
      'GEOFENCING_FORBIDDEN',
      403,
      'Seuls DIRECTION et ADMIN peuvent modifier le rayon du chantier.',
    );
  }

  return null;
}

export function assertUpdateSiteRadiusAllowed(
  user: AuthLikeUser,
  existingRadiusKm: number,
  input: UpdateSiteInput,
) {
  const nextRadiusKm = input.radiusKmProvided ? input.radiusKm : existingRadiusKm;

  if (!canManageGeofencing(user.role) && Math.abs(nextRadiusKm - existingRadiusKm) > Number.EPSILON) {
    return jsonProjectError(
      'GEOFENCING_FORBIDDEN',
      403,
      'Seuls DIRECTION et ADMIN peuvent modifier le rayon du chantier.',
    );
  }

  return null;
}

export async function validateProjectManager(
  prisma: PrismaClient,
  projectManagerId: string,
  currentUser: AuthLikeUser,
) {
  const manager = await prisma.user.findUnique({
    where: { id: projectManagerId },
    select: {
      id: true,
      role: true,
      isActive: true,
    },
  });

  if (!manager || !manager.isActive || manager.role !== Role.PROJECT_MANAGER) {
    return false;
  }

  if (currentUser.role === Role.PROJECT_MANAGER && currentUser.id !== projectManagerId) {
    return false;
  }

  return true;
}

export async function validateSiteManager(prisma: PrismaClient, siteManagerId: string) {
  const manager = await prisma.user.findUnique({
    where: { id: siteManagerId },
    select: {
      id: true,
      isActive: true,
    },
  });

  return Boolean(manager?.isActive);
}

export async function archiveProject(prisma: PrismaClient, projectId: string) {
  const activeSites = await prisma.site.count({
    where: {
      projectId,
      status: SiteStatus.ACTIVE,
    },
  });

  if (activeSites > 0) {
    return {
      error: jsonProjectError(
        'PROJECT_HAS_ACTIVE_SITES',
        400,
        "Impossible d'archiver ce projet tant qu'un chantier actif y est rattache.",
      ),
      project: null,
    };
  }

  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      status: ProjectStatus.ARCHIVED,
    },
    select: projectDetailSelect,
  });

  return {
    error: null,
    project,
  };
}

export function summarizePresences(payload: {
  projectId: string;
  sites: {
    id: string;
    name: string;
    status: SiteStatus;
    workers: PresenceWorkerItem[];
  }[];
  date: string;
}): ProjectPresenceSummary {
  const sites: ProjectPresenceSiteItem[] = payload.sites.map((site) => ({
    id: site.id,
    name: site.name,
    status: site.status,
    presentCount: site.workers.length,
    workers: site.workers,
  }));

  const uniqueWorkers = new Map<string, PresenceWorkerItem>();

  for (const site of sites) {
    for (const worker of site.workers) {
      uniqueWorkers.set(worker.userId, worker);
    }
  }

  return {
    projectId: payload.projectId,
    date: payload.date,
    totals: {
      activeSites: sites.filter((site) => site.status === SiteStatus.ACTIVE).length,
      presentWorkers: uniqueWorkers.size,
    },
    sites,
  };
}

export function serializeTodaySiteItems(
  sites: {
    id: string;
    projectId: string;
    name: string;
    address: string;
    latitude: Prisma.Decimal;
    longitude: Prisma.Decimal;
    radiusKm: Prisma.Decimal;
    status: SiteStatus;
    hasOpenSession: boolean;
  }[],
): TodaySiteItem[] {
  return sites.map((site) => ({
    id: site.id,
    projectId: site.projectId,
    name: site.name,
    address: site.address,
    latitude: site.latitude.toNumber(),
    longitude: site.longitude.toNumber(),
    radiusKm: site.radiusKm.toNumber(),
    status: site.status,
    hasOpenSession: site.hasOpenSession,
  }));
}

function sanitizeProjectName(value: unknown) {
  const name = sanitizeString(value);

  if (!name || name.length < 3 || name.length > 100) {
    return null;
  }

  return name;
}

function sanitizeString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeDateString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sanitizeNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function parseProjectStatus(value: unknown) {
  return typeof value === 'string' && Object.values(ProjectStatus).includes(value as ProjectStatus)
    ? (value as ProjectStatus)
    : null;
}

function parseSiteStatus(value: unknown) {
  return typeof value === 'string' && Object.values(SiteStatus).includes(value as SiteStatus)
    ? (value as SiteStatus)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
