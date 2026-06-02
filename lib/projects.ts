import { Prisma, ProjectStatus, Role, SiteGeofenceType, SiteStatus, SiteType, TeamMemberStatus, type PrismaClient } from '@prisma/client';
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
  SiteGeofencePolygon,
  TodaySiteItem,
  UpdateProjectInput,
  UpdateSiteInput,
} from '@/types/projects';

const PROJECT_READ_ROLES: readonly Role[] = [
  Role.PROJECT_MANAGER,
  Role.BE_MANAGER,
  Role.NEGOTIATION_MANAGER,
  Role.FLEET_MANAGER,
  Role.DIRECTION,
  Role.ADMIN,
];
const PROJECT_WRITE_ROLES: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION, Role.ADMIN];
const SITE_WRITE_ROLES: readonly Role[] = [
  Role.PROJECT_MANAGER,
  Role.BE_MANAGER,
  Role.NEGOTIATION_MANAGER,
  Role.FLEET_MANAGER,
  Role.DIRECTION,
  Role.ADMIN,
];
const GEOFENCING_ROLES: readonly Role[] = [Role.DIRECTION, Role.ADMIN];

export const sitePublicSelect = {
  id: true,
  projectId: true,
  name: true,
  address: true,
  siteType: true,
  requiresClockIn: true,
  latitude: true,
  longitude: true,
  radiusKm: true,
  geofenceType: true,
  geofencePolygon: true,
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

export const SITE_ADDRESS_NOT_PROVIDED = 'Adresse non renseignée';

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

export function canWriteSites(role: Role) {
  return SITE_WRITE_ROLES.includes(role);
}

export function canManageGeofencing(role: Role) {
  return GEOFENCING_ROLES.includes(role);
}

export function canViewArchivedProjects(role: Role) {
  return role === Role.ADMIN;
}

export function projectAccessWhere(user: AuthLikeUser, options: { includeInactive?: boolean } = {}): Prisma.ProjectWhereInput {
  const visibilityWhere = canViewArchivedProjects(user.role) && options.includeInactive
    ? {}
    : {
        status: ProjectStatus.IN_PROGRESS,
      };

  if (user.role === Role.PROJECT_MANAGER) {
    return {
      projectManagerId: user.id,
      ...visibilityWhere,
    };
  }

  return visibilityWhere;
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
    siteType: site.siteType,
    requiresClockIn: site.requiresClockIn,
    latitude: site.latitude.toNumber(),
    longitude: site.longitude.toNumber(),
    radiusKm: site.radiusKm.toNumber(),
    geofenceType: site.geofenceType,
    geofencePolygon: serializeGeofencePolygon(site.geofencePolygon),
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

  if (!name || !address || !city || !projectManagerId || !status || !startDate) {
    return null;
  }

  return {
    name,
    description: description ?? '',
    address,
    city,
    projectManagerId,
    status,
    startDate,
    endDate,
  };
}

export function parseUpdateProjectInput(body: unknown): UpdateProjectInput | null {
  if (!isRecord(body)) {
    return null;
  }

  const input: UpdateProjectInput = {};

  if ('name' in body) {
    const name = sanitizeProjectName(body.name);
    if (!name) return null;
    input.name = name;
  }

  if ('description' in body) {
    input.description = sanitizeString(body.description) ?? '';
  }

  if ('address' in body) {
    const address = sanitizeString(body.address);
    if (!address) return null;
    input.address = address;
  }

  if ('city' in body) {
    const city = sanitizeString(body.city);
    if (!city) return null;
    input.city = city;
  }

  if ('projectManagerId' in body) {
    const projectManagerId = sanitizeString(body.projectManagerId);
    if (!projectManagerId) return null;
    input.projectManagerId = projectManagerId;
  }

  if ('status' in body) {
    const status = parseProjectStatus(body.status);
    if (!status) return null;
    input.status = status;
  }

  if ('startDate' in body) {
    const startDate = sanitizeDateString(body.startDate);
    if (!startDate) return null;
    input.startDate = startDate;
  }

  if ('endDate' in body) {
    const endDate = body.endDate === null || body.endDate === undefined ? null : sanitizeDateString(body.endDate);
    if (endDate === null && body.endDate !== null && body.endDate !== undefined) return null;
    input.endDate = endDate;
  }

  return hasUpdateFields(input) ? input : null;
}

export function parseCreateSiteInput(body: unknown): CreateSiteInput | null {
  if (!isRecord(body)) {
    return null;
  }

  const name = sanitizeProjectName(body.name);
  const address = sanitizeString(body.address) ?? SITE_ADDRESS_NOT_PROVIDED;
  const siteType = parseSiteType(body.siteType) ?? SiteType.WORKSITE;
  const requiresClockIn = parseBoolean(body.requiresClockIn) ?? defaultRequiresClockIn(siteType);
  const description = sanitizeString(body.description);
  const siteManagerId = sanitizeString(body.siteManagerId);
  const startDate = sanitizeDateString(body.startDate);
  const endDate = body.endDate === null || body.endDate === undefined ? null : sanitizeDateString(body.endDate);
  const status = parseSiteStatus(body.status) ?? SiteStatus.ACTIVE;
  const latitude = sanitizeNumber(body.latitude);
  const longitude = sanitizeNumber(body.longitude);
  const area = sanitizeNumber(body.area) ?? 0;
  const radiusKmProvided = body.radiusKm !== undefined && body.radiusKm !== null;
  const radiusKm =
    radiusKmProvided ? sanitizeNumber(body.radiusKm) : 2.0;
  const geofence = parseSiteGeofenceInput(body);

  if (
    !name ||
    !siteManagerId ||
    !startDate ||
    !status ||
    (requiresClockIn && !validateSiteGps(latitude, longitude)) ||
    radiusKm === null ||
    !geofence
  ) {
    return null;
  }

  return {
    name,
    address,
    siteType,
    requiresClockIn,
    latitude: latitude ?? 0,
    longitude: longitude ?? 0,
    radiusKm,
    radiusKmProvided,
    geofenceType: geofence.type,
    geofencePolygon: geofence.polygon,
    description: description ?? '',
    status,
    area,
    startDate,
    endDate,
    siteManagerId,
  };
}

export function parseUpdateSiteInput(body: unknown): UpdateSiteInput | null {
  if (!isRecord(body)) {
    return null;
  }

  const input: UpdateSiteInput = {
    radiusKmProvided: false,
  };

  if ('projectId' in body) {
    const projectId = sanitizeString(body.projectId);
    if (!projectId) return null;
    input.projectId = projectId;
  }

  if ('name' in body) {
    const name = sanitizeProjectName(body.name);
    if (!name) return null;
    input.name = name;
  }

  if ('address' in body) {
    input.address = sanitizeString(body.address) ?? SITE_ADDRESS_NOT_PROVIDED;
  }

  if ('siteType' in body) {
    const siteType = parseSiteType(body.siteType);
    if (!siteType) return null;
    input.siteType = siteType;
  }

  if ('requiresClockIn' in body) {
    const requiresClockIn = parseBoolean(body.requiresClockIn);
    if (requiresClockIn === null) return null;
    input.requiresClockIn = requiresClockIn;
  }

  if ('description' in body) {
    input.description = sanitizeString(body.description) ?? '';
  }

  if ('siteManagerId' in body) {
    const siteManagerId = sanitizeString(body.siteManagerId);
    if (!siteManagerId) return null;
    input.siteManagerId = siteManagerId;
  }

  if ('startDate' in body) {
    const startDate = sanitizeDateString(body.startDate);
    if (!startDate) return null;
    input.startDate = startDate;
  }

  if ('endDate' in body) {
    const endDate = body.endDate === null || body.endDate === undefined ? null : sanitizeDateString(body.endDate);
    if (endDate === null && body.endDate !== null && body.endDate !== undefined) return null;
    input.endDate = endDate;
  }

  if ('status' in body) {
    const status = parseSiteStatus(body.status);
    if (!status) return null;
    input.status = status;
  }

  if ('latitude' in body) {
    const latitude = sanitizeNumber(body.latitude);
    if (latitude === null) return null;
    input.latitude = latitude;
  }

  if ('longitude' in body) {
    const longitude = sanitizeNumber(body.longitude);
    if (longitude === null) return null;
    input.longitude = longitude;
  }

  if ('area' in body) {
    const area = sanitizeNumber(body.area);
    if (area === null) return null;
    input.area = area;
  }

  if ('radiusKm' in body) {
    const radiusKm = sanitizeNumber(body.radiusKm);
    if (radiusKm === null) return null;
    input.radiusKm = radiusKm;
    input.radiusKmProvided = true;
  }

  if ('geofenceType' in body || 'geofencePolygon' in body) {
    const geofence = parseSiteGeofenceInput(body);
    if (!geofence) return null;
    input.geofenceType = geofence.type;
    input.geofencePolygon = geofence.polygon;
  }

  return hasUpdateFields(input) ? input : null;
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

export function validateSiteGps(latitude: number | null, longitude: number | null) {
  return Boolean(
    latitude !== null &&
      longitude !== null &&
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180 &&
      (Math.abs(latitude) > 0.01 || Math.abs(longitude) > 0.01),
  );
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
  const nextRadiusKm = input.radiusKmProvided && input.radiusKm !== undefined ? input.radiusKm : existingRadiusKm;

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
      role: true,
      isActive: true,
    },
  });

  return Boolean(manager?.isActive && manager.role === Role.GENERAL_SUPERVISOR);
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
    siteType: SiteType;
    requiresClockIn: boolean;
    latitude: Prisma.Decimal;
    longitude: Prisma.Decimal;
    radiusKm: Prisma.Decimal;
    geofenceType: SiteGeofenceType;
    geofencePolygon: Prisma.JsonValue | null;
    status: SiteStatus;
    hasOpenSession: boolean;
    assignmentIds?: string[];
    source?: TodaySiteItem['source'];
  }[],
): TodaySiteItem[] {
  return sites.map((site) => {
    const item: TodaySiteItem = {
      id: site.id,
      projectId: site.projectId,
      name: site.name,
      address: site.address,
      siteType: site.siteType,
      requiresClockIn: site.requiresClockIn,
      latitude: site.latitude.toNumber(),
      longitude: site.longitude.toNumber(),
      radiusKm: site.radiusKm.toNumber(),
      geofenceType: site.geofenceType,
      geofencePolygon: serializeGeofencePolygon(site.geofencePolygon),
      status: site.status,
      hasOpenSession: site.hasOpenSession,
    };

    if (site.assignmentIds) {
      item.assignmentIds = site.assignmentIds;
    }

    if (site.source) {
      item.source = site.source;
    }

    return item;
  });
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

function parseSiteType(value: unknown) {
  return typeof value === 'string' && Object.values(SiteType).includes(value as SiteType)
    ? (value as SiteType)
    : null;
}

function parseBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function defaultRequiresClockIn(siteType: SiteType) {
  return siteType !== SiteType.OFFICE;
}

function parseSiteGeofenceType(value: unknown) {
  return typeof value === 'string' && Object.values(SiteGeofenceType).includes(value as SiteGeofenceType)
    ? (value as SiteGeofenceType)
    : null;
}

function parseSiteGeofenceInput(body: Record<string, unknown>) {
  const type = parseSiteGeofenceType(body.geofenceType) ?? SiteGeofenceType.RADIUS;

  if (type === SiteGeofenceType.RADIUS) {
    return {
      type,
      polygon: null,
    };
  }

  const polygon = normalizeGeofencePolygon(body.geofencePolygon);
  return polygon
    ? {
        type,
        polygon,
      }
    : null;
}

export function normalizeGeofencePolygon(value: unknown): SiteGeofencePolygon | null {
  if (!isRecord(value) || value.type !== 'Polygon' || !Array.isArray(value.coordinates)) {
    return null;
  }

  const coordinates = value.coordinates as unknown[];
  const ring = coordinates[0];
  if (!Array.isArray(ring)) {
    return null;
  }

  const points: [number, number][] = [];
  for (const point of ring) {
    if (!Array.isArray(point) || point.length < 2) {
      return null;
    }

    const lng = sanitizeNumber(point[0]);
    const lat = sanitizeNumber(point[1]);
    if (lng === null || lat === null || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return null;
    }

    points.push([Number(lng.toFixed(6)), Number(lat.toFixed(6))]);
  }

  const openPoints = removeClosingPoint(points);
  const uniquePoints = new Set(openPoints.map((point) => `${point[0]}:${point[1]}`));

  if (openPoints.length < 3 || uniquePoints.size < 3) {
    return null;
  }

  return {
    type: 'Polygon',
    coordinates: [[...openPoints, openPoints[0]!]],
  };
}

function serializeGeofencePolygon(value: Prisma.JsonValue | null): SiteGeofencePolygon | null {
  return normalizeGeofencePolygon(value);
}

function removeClosingPoint(points: [number, number][]) {
  if (points.length < 2) {
    return points;
  }

  const first = points[0]!;
  const last = points[points.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? points.slice(0, -1) : points;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasUpdateFields(input: Record<string, unknown>) {
  return Object.keys(input).some((key) => key !== 'radiusKmProvided');
}
