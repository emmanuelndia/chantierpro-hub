import {
  GeneralSupervisorSiteScopeStatus,
  Prisma,
  ProjectStatus,
  Role,
  SiteStatus,
  type PrismaClient,
} from '@prisma/client';
import type {
  CreateGeneralSupervisorScopeRequest,
  GeneralSupervisorProjectScopeItem,
  GeneralSupervisorScopeItem,
  GeneralSupervisorScopesResponse,
  GeneralSupervisorSiteScopeItem,
  UpdateGeneralSupervisorScopeRequest,
} from '@/types/general-supervisor-scopes';

type AuthLikeUser = {
  id: string;
  role: Role;
};

const SCOPE_MANAGEMENT_ROLES: readonly Role[] = [Role.PROJECT_MANAGER, Role.ADMIN];
const SCOPE_WEB_READ_ROLES: readonly Role[] = [
  Role.PROJECT_MANAGER,
  Role.ADMIN,
  Role.GENERAL_SUPERVISOR,
];
const CLOSED_PROJECT_STATUSES: readonly ProjectStatus[] = [ProjectStatus.ARCHIVED, ProjectStatus.COMPLETED];

const userOptionSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} satisfies Prisma.UserSelect;

const projectOptionSelect = {
  id: true,
  name: true,
} satisfies Prisma.ProjectSelect;

const siteScopeSelect = {
  id: true,
  generalSupervisorId: true,
  projectManagerId: true,
  siteId: true,
  startDate: true,
  endDate: true,
  status: true,
  createdAt: true,
  generalSupervisor: {
    select: userOptionSelect,
  },
  projectManager: {
    select: userOptionSelect,
  },
  site: {
    select: {
      id: true,
      name: true,
      address: true,
      project: {
        select: projectOptionSelect,
      },
    },
  },
} satisfies Prisma.GeneralSupervisorSiteScopeSelect;

const projectScopeSelect = {
  id: true,
  generalSupervisorId: true,
  projectManagerId: true,
  projectId: true,
  startDate: true,
  endDate: true,
  status: true,
  createdAt: true,
  generalSupervisor: {
    select: userOptionSelect,
  },
  projectManager: {
    select: userOptionSelect,
  },
  project: {
    select: projectOptionSelect,
  },
} satisfies Prisma.GeneralSupervisorProjectScopeSelect;

type SiteScopeRow = Prisma.GeneralSupervisorSiteScopeGetPayload<{ select: typeof siteScopeSelect }>;
type ProjectScopeRow = Prisma.GeneralSupervisorProjectScopeGetPayload<{ select: typeof projectScopeSelect }>;

export function canManageGeneralSupervisorScopes(role: Role) {
  return SCOPE_MANAGEMENT_ROLES.includes(role);
}

export function canReadGeneralSupervisorScopes(role: Role) {
  return SCOPE_WEB_READ_ROLES.includes(role);
}

export function generalSupervisorActiveScopeWhere(userId: string, date: Date = new Date()) {
  return {
    generalSupervisorId: userId,
    status: GeneralSupervisorSiteScopeStatus.ACTIVE,
    startDate: {
      lte: date,
    },
    OR: [{ endDate: null }, { endDate: { gte: date } }],
  };
}

export function generalSupervisorPlanningSiteWhere(user: AuthLikeUser, date: Date): Prisma.SiteWhereInput {
  return {
    status: SiteStatus.ACTIVE,
    project: {
      status: {
        notIn: [...CLOSED_PROJECT_STATUSES],
      },
    },
    OR: [
      {
        generalSupervisorScopes: {
          some: generalSupervisorActiveScopeWhere(user.id, date),
        },
      },
      {
        project: {
          generalSupervisorProjectScopes: {
            some: generalSupervisorActiveScopeWhere(user.id, date),
          },
        },
      },
    ],
  };
}

export function generalSupervisorPlanningProjectWhere(user: AuthLikeUser, date: Date): Prisma.ProjectWhereInput {
  return {
    status: {
      notIn: [...CLOSED_PROJECT_STATUSES],
    },
    OR: [
      {
        generalSupervisorProjectScopes: {
          some: generalSupervisorActiveScopeWhere(user.id, date),
        },
      },
      {
        sites: {
          some: {
            status: SiteStatus.ACTIVE,
            generalSupervisorScopes: {
              some: generalSupervisorActiveScopeWhere(user.id, date),
            },
          },
        },
      },
    ],
  };
}

export async function getGeneralSupervisorScopes(
  prisma: PrismaClient,
  user: AuthLikeUser,
): Promise<GeneralSupervisorScopesResponse | Response> {
  if (!canReadGeneralSupervisorScopes(user.role)) {
    return jsonScopeError('FORBIDDEN', 'Acces refuse a la gestion des perimetres.', 403);
  }

  const siteWhere = buildReadableSiteWhere(user);
  const projectWhere = buildReadableProjectWhere(user);

  const [siteScopes, projectScopes, generalSupervisors, sites, projects] = await Promise.all([
    prisma.generalSupervisorSiteScope.findMany({
      where: {
        site: siteWhere,
        ...(user.role === Role.GENERAL_SUPERVISOR ? { generalSupervisorId: user.id } : {}),
      },
      orderBy: [{ status: 'asc' }, { site: { project: { name: 'asc' } } }, { site: { name: 'asc' } }, { startDate: 'desc' }],
      select: siteScopeSelect,
    }),
    prisma.generalSupervisorProjectScope.findMany({
      where: {
        project: projectWhere,
        ...(user.role === Role.GENERAL_SUPERVISOR ? { generalSupervisorId: user.id } : {}),
      },
      orderBy: [{ status: 'asc' }, { project: { name: 'asc' } }, { startDate: 'desc' }],
      select: projectScopeSelect,
    }),
    prisma.user.findMany({
      where: {
        role: Role.GENERAL_SUPERVISOR,
        isActive: true,
        ...(user.role === Role.GENERAL_SUPERVISOR ? { id: user.id } : {}),
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
      select: userOptionSelect,
    }),
    prisma.site.findMany({
      where: siteWhere,
      orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        address: true,
        project: {
          select: projectOptionSelect,
        },
      },
    }),
    prisma.project.findMany({
      where: projectWhere,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: projectOptionSelect,
    }),
  ]);

  const serializedProjectScopes = projectScopes.map(serializeProjectScope);
  const serializedSiteScopes = siteScopes.map(serializeSiteScope);

  return {
    scopes: [...serializedProjectScopes, ...serializedSiteScopes],
    projectScopes: serializedProjectScopes,
    siteScopes: serializedSiteScopes,
    generalSupervisors,
    projects,
    sites,
  };
}

export async function createGeneralSupervisorScope(
  prisma: PrismaClient,
  user: AuthLikeUser,
  body: unknown,
): Promise<{ scope: GeneralSupervisorScopeItem; scopes?: GeneralSupervisorScopeItem[]; createdCount?: number; skippedCount?: number } | Response> {
  if (!canManageGeneralSupervisorScopes(user.role)) {
    return jsonScopeError('FORBIDDEN', 'Acces refuse a la gestion des perimetres.', 403);
  }

  const input = parseCreateScopeInput(body);
  if (!input) {
    return jsonScopeError('BAD_REQUEST', 'Payload perimetre invalide.', 400);
  }

  const startDate = parseDate(input.startDate);
  const endDate = input.endDate ? parseDate(input.endDate) : null;
  if (!startDate || (input.endDate && !endDate)) {
    return jsonScopeError('INVALID_DATE', 'Dates de perimetre invalides.', 400);
  }

  if (endDate && endDate < startDate) {
    return jsonScopeError('INVALID_DATE_RANGE', 'La date de fin doit etre posterieure a la date de debut.', 400);
  }

  const generalSupervisor = await prisma.user.findFirst({
    where: {
      id: input.generalSupervisorId,
      role: Role.GENERAL_SUPERVISOR,
      isActive: true,
    },
    select: { id: true },
  });

  if (!generalSupervisor) {
    return jsonScopeError('GENERAL_SUPERVISOR_NOT_FOUND', 'Superviseur general invalide.', 404);
  }

  if ((input.scopeType ?? 'SITES') === 'PROJECT') {
    return createProjectScope(prisma, user, input, startDate, endDate);
  }

  return createSiteScopes(prisma, user, input, startDate, endDate);
}

export async function updateGeneralSupervisorScope(
  prisma: PrismaClient,
  user: AuthLikeUser,
  scopeId: string,
  body: unknown,
): Promise<{ scope: GeneralSupervisorScopeItem } | Response> {
  if (!canManageGeneralSupervisorScopes(user.role)) {
    return jsonScopeError('FORBIDDEN', 'Acces refuse a la gestion des perimetres.', 403);
  }

  const input = parseUpdateScopeInput(body);
  if (!input) {
    return jsonScopeError('BAD_REQUEST', 'Payload perimetre invalide.', 400);
  }

  const existingSiteScope = await prisma.generalSupervisorSiteScope.findFirst({
    where: {
      id: scopeId,
      site: buildManageableSiteWhere(user),
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
    },
  });

  if (existingSiteScope) {
    const result = updateDateStatus(input, existingSiteScope.startDate, existingSiteScope.endDate);
    if (result instanceof Response) return result;

    const scope = await prisma.generalSupervisorSiteScope.update({
      where: { id: existingSiteScope.id },
      data: result,
      select: siteScopeSelect,
    });

    return { scope: serializeSiteScope(scope) };
  }

  const existingProjectScope = await prisma.generalSupervisorProjectScope.findFirst({
    where: {
      id: scopeId,
      project: buildManageableProjectWhere(user),
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
    },
  });

  if (!existingProjectScope) {
    return jsonScopeError('NOT_FOUND', 'Perimetre introuvable.', 404);
  }

  const result = updateDateStatus(input, existingProjectScope.startDate, existingProjectScope.endDate);
  if (result instanceof Response) return result;

  const scope = await prisma.generalSupervisorProjectScope.update({
    where: { id: existingProjectScope.id },
    data: result,
    select: projectScopeSelect,
  });

  return { scope: serializeProjectScope(scope) };
}

export async function deactivateGeneralSupervisorScope(prisma: PrismaClient, user: AuthLikeUser, scopeId: string) {
  if (!canManageGeneralSupervisorScopes(user.role)) {
    return jsonScopeError('FORBIDDEN', 'Acces refuse a la gestion des perimetres.', 403);
  }

  const existingSiteScope = await prisma.generalSupervisorSiteScope.findFirst({
    where: {
      id: scopeId,
      site: buildManageableSiteWhere(user),
    },
    select: { id: true },
  });

  if (existingSiteScope) {
    await prisma.generalSupervisorSiteScope.update({
      where: { id: existingSiteScope.id },
      data: { status: GeneralSupervisorSiteScopeStatus.INACTIVE },
    });

    return new Response(null, { status: 204 });
  }

  const existingProjectScope = await prisma.generalSupervisorProjectScope.findFirst({
    where: {
      id: scopeId,
      project: buildManageableProjectWhere(user),
    },
    select: { id: true },
  });

  if (!existingProjectScope) {
    return jsonScopeError('NOT_FOUND', 'Perimetre introuvable.', 404);
  }

  await prisma.generalSupervisorProjectScope.update({
    where: { id: existingProjectScope.id },
    data: { status: GeneralSupervisorSiteScopeStatus.INACTIVE },
  });

  return new Response(null, { status: 204 });
}

export function jsonScopeError(code: string, message: string, status: number) {
  return Response.json({ code, message }, { status });
}

function buildManageableSiteWhere(user: AuthLikeUser): Prisma.SiteWhereInput {
  return {
    status: SiteStatus.ACTIVE,
    project: buildManageableProjectWhere(user),
  };
}

function buildManageableProjectWhere(user: AuthLikeUser): Prisma.ProjectWhereInput {
  return {
    status: {
      notIn: [...CLOSED_PROJECT_STATUSES],
    },
    ...(user.role === Role.PROJECT_MANAGER ? { projectManagerId: user.id } : {}),
  };
}

function buildReadableProjectWhere(user: AuthLikeUser): Prisma.ProjectWhereInput {
  if (user.role === Role.GENERAL_SUPERVISOR) {
    return {
      status: {
        notIn: [...CLOSED_PROJECT_STATUSES],
      },
      OR: [
        {
          generalSupervisorProjectScopes: {
            some: {
              generalSupervisorId: user.id,
            },
          },
        },
        {
          sites: {
            some: {
              generalSupervisorScopes: {
                some: {
                  generalSupervisorId: user.id,
                },
              },
            },
          },
        },
      ],
    };
  }

  return buildManageableProjectWhere(user);
}

function buildReadableSiteWhere(user: AuthLikeUser): Prisma.SiteWhereInput {
  if (user.role === Role.GENERAL_SUPERVISOR) {
    return {
      status: SiteStatus.ACTIVE,
      project: {
        status: {
          notIn: [...CLOSED_PROJECT_STATUSES],
        },
      },
      OR: [
        {
          generalSupervisorScopes: {
            some: {
              generalSupervisorId: user.id,
            },
          },
        },
        {
          project: {
            generalSupervisorProjectScopes: {
              some: {
                generalSupervisorId: user.id,
              },
            },
          },
        },
      ],
    };
  }

  return buildManageableSiteWhere(user);
}

async function createProjectScope(
  prisma: PrismaClient,
  user: AuthLikeUser,
  input: CreateGeneralSupervisorScopeRequest,
  startDate: Date,
  endDate: Date | null,
) {
  if (!input.projectId) {
    return jsonScopeError('PROJECT_REQUIRED', 'Projet requis pour un perimetre projet entier.', 400);
  }

  const project = await prisma.project.findFirst({
    where: {
      id: input.projectId,
      ...buildManageableProjectWhere(user),
    },
    select: {
      id: true,
      projectManagerId: true,
    },
  });

  if (!project) {
    return jsonScopeError('PROJECT_NOT_FOUND', 'Projet introuvable dans votre perimetre actif.', 404);
  }

  const duplicate = await prisma.generalSupervisorProjectScope.findFirst({
    where: {
      generalSupervisorId: input.generalSupervisorId,
      projectId: input.projectId,
      startDate,
      status: GeneralSupervisorSiteScopeStatus.ACTIVE,
    },
    select: { id: true },
  });

  if (duplicate) {
    return jsonScopeError('SCOPE_CONFLICT', 'Ce projet est deja confie a ce superviseur general pour cette date.', 409);
  }

  try {
    const scope = await prisma.generalSupervisorProjectScope.create({
      data: {
        generalSupervisorId: input.generalSupervisorId,
        projectManagerId: project.projectManagerId,
        projectId: input.projectId,
        startDate,
        endDate,
        status: GeneralSupervisorSiteScopeStatus.ACTIVE,
      },
      select: projectScopeSelect,
    });

    return { scope: serializeProjectScope(scope) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return jsonScopeError('SCOPE_CONFLICT', 'Ce perimetre existe deja.', 409);
    }

    throw error;
  }
}

async function createSiteScopes(
  prisma: PrismaClient,
  user: AuthLikeUser,
  input: CreateGeneralSupervisorScopeRequest,
  startDate: Date,
  endDate: Date | null,
) {
  const siteIds = input.siteIds?.length ? input.siteIds : input.siteId ? [input.siteId] : [];
  if (siteIds.length === 0) {
    return jsonScopeError('SITES_REQUIRED', 'Selectionnez au moins un chantier.', 400);
  }

  const uniqueSiteIds = [...new Set(siteIds)];
  const sites = await prisma.site.findMany({
    where: {
      id: {
        in: uniqueSiteIds,
      },
      ...buildManageableSiteWhere(user),
    },
    select: {
      id: true,
      project: {
        select: {
          projectManagerId: true,
        },
      },
    },
  });

  if (sites.length !== uniqueSiteIds.length) {
    return jsonScopeError('SITE_NOT_FOUND', 'Un ou plusieurs chantiers sont introuvables dans votre perimetre.', 404);
  }

  const existingScopes = await prisma.generalSupervisorSiteScope.findMany({
    where: {
      generalSupervisorId: input.generalSupervisorId,
      siteId: {
        in: uniqueSiteIds,
      },
      startDate,
      status: GeneralSupervisorSiteScopeStatus.ACTIVE,
    },
    select: { siteId: true },
  });
  const existingSiteIds = new Set(existingScopes.map((scope) => scope.siteId));
  const sitesToCreate = sites.filter((site) => !existingSiteIds.has(site.id));

  if (sitesToCreate.length === 0) {
    return jsonScopeError('SCOPE_CONFLICT', 'Ces chantiers sont deja confies a ce superviseur general pour cette date.', 409);
  }

  const createdRows: SiteScopeRow[] = [];
  for (const site of sitesToCreate) {
    const scope = await prisma.generalSupervisorSiteScope.create({
      data: {
        generalSupervisorId: input.generalSupervisorId,
        projectManagerId: site.project.projectManagerId,
        siteId: site.id,
        startDate,
        endDate,
        status: GeneralSupervisorSiteScopeStatus.ACTIVE,
      },
      select: siteScopeSelect,
    });
    createdRows.push(scope);
  }

  const serializedScopes = createdRows.map(serializeSiteScope);

  return {
    scope: serializedScopes[0]!,
    scopes: serializedScopes,
    createdCount: serializedScopes.length,
    skippedCount: existingSiteIds.size,
  };
}

function updateDateStatus(
  input: UpdateGeneralSupervisorScopeRequest,
  currentStartDate: Date,
  currentEndDate: Date | null,
): Prisma.GeneralSupervisorSiteScopeUpdateInput | Response {
  const startDate = input.startDate ? parseDate(input.startDate) : currentStartDate;
  const endDate = input.endDate === undefined ? currentEndDate : input.endDate ? parseDate(input.endDate) : null;

  if (!startDate || (input.endDate && !endDate)) {
    return jsonScopeError('INVALID_DATE', 'Dates de perimetre invalides.', 400);
  }

  if (endDate && endDate < startDate) {
    return jsonScopeError('INVALID_DATE_RANGE', 'La date de fin doit etre posterieure a la date de debut.', 400);
  }

  return {
    ...(input.startDate !== undefined ? { startDate } : {}),
    ...(input.endDate !== undefined ? { endDate } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
  };
}

function parseCreateScopeInput(body: unknown): CreateGeneralSupervisorScopeRequest | null {
  if (!isRecord(body)) return null;

  const generalSupervisorId = getString(body.generalSupervisorId);
  const scopeType = getScopeType(body.scopeType);
  const projectId = getString(body.projectId);
  const siteId = getString(body.siteId);
  const siteIds = getStringArray(body.siteIds);
  const startDate = getString(body.startDate);
  const endDate = getNullableString(body.endDate);

  if (!generalSupervisorId || !startDate) {
    return null;
  }

  const normalizedScopeType = scopeType ?? (projectId && !siteId && siteIds.length === 0 ? 'PROJECT' : 'SITES');

  if (normalizedScopeType === 'PROJECT' && !projectId) {
    return null;
  }

  if (normalizedScopeType === 'SITES' && !siteId && siteIds.length === 0) {
    return null;
  }

  return {
    generalSupervisorId,
    scopeType: normalizedScopeType,
    ...(projectId ? { projectId } : {}),
    ...(siteId ? { siteId } : {}),
    ...(siteIds.length ? { siteIds } : {}),
    startDate,
    ...(endDate !== undefined ? { endDate } : {}),
  };
}

function parseUpdateScopeInput(body: unknown): UpdateGeneralSupervisorScopeRequest | null {
  if (!isRecord(body)) return null;

  const input: UpdateGeneralSupervisorScopeRequest = {};

  if ('startDate' in body) {
    const startDate = getString(body.startDate);
    if (!startDate) return null;
    input.startDate = startDate;
  }

  if ('endDate' in body) {
    const endDate = getNullableString(body.endDate);
    if (endDate === undefined) return null;
    input.endDate = endDate;
  }

  if ('status' in body) {
    if (!isScopeStatus(body.status)) return null;
    input.status = body.status;
  }

  return input;
}

function serializeSiteScope(scope: SiteScopeRow): GeneralSupervisorSiteScopeItem {
  return {
    id: scope.id,
    scopeType: 'SITES',
    generalSupervisorId: scope.generalSupervisorId,
    projectManagerId: scope.projectManagerId,
    siteId: scope.siteId,
    startDate: formatDate(scope.startDate),
    endDate: scope.endDate ? formatDate(scope.endDate) : null,
    status: scope.status,
    createdAt: scope.createdAt.toISOString(),
    generalSupervisor: scope.generalSupervisor,
    projectManager: scope.projectManager,
    site: scope.site,
    project: scope.site.project,
  };
}

function serializeProjectScope(scope: ProjectScopeRow): GeneralSupervisorProjectScopeItem {
  return {
    id: scope.id,
    scopeType: 'PROJECT',
    generalSupervisorId: scope.generalSupervisorId,
    projectManagerId: scope.projectManagerId,
    projectId: scope.projectId,
    startDate: formatDate(scope.startDate),
    endDate: scope.endDate ? formatDate(scope.endDate) : null,
    status: scope.status,
    createdAt: scope.createdAt.toISOString(),
    generalSupervisor: scope.generalSupervisor,
    projectManager: scope.projectManager,
    project: scope.project,
    site: null,
  };
}

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => getString(item))
    .filter((item): item is string => Boolean(item));
}

function getNullableString(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return getString(value);
}

function getScopeType(value: unknown) {
  if (value === 'PROJECT' || value === 'SITES') return value;
  return null;
}

function isScopeStatus(value: unknown): value is GeneralSupervisorSiteScopeStatus {
  return (
    value === GeneralSupervisorSiteScopeStatus.ACTIVE ||
    value === GeneralSupervisorSiteScopeStatus.INACTIVE
  );
}
