import { GeneralSupervisorSiteScopeStatus, Prisma, Role, SiteStatus, type PrismaClient } from '@prisma/client';
import type {
  CreateGeneralSupervisorScopeRequest,
  GeneralSupervisorScopeItem,
  GeneralSupervisorScopesResponse,
  UpdateGeneralSupervisorScopeRequest,
} from '@/types/general-supervisor-scopes';

type AuthLikeUser = {
  id: string;
  role: Role;
};

const SCOPE_MANAGEMENT_ROLES: readonly Role[] = [Role.PROJECT_MANAGER, Role.DIRECTION, Role.ADMIN];
const SCOPE_WEB_READ_ROLES: readonly Role[] = [
  Role.PROJECT_MANAGER,
  Role.DIRECTION,
  Role.ADMIN,
  Role.GENERAL_SUPERVISOR,
];

const scopeSelect = {
  id: true,
  generalSupervisorId: true,
  projectManagerId: true,
  siteId: true,
  startDate: true,
  endDate: true,
  status: true,
  createdAt: true,
  generalSupervisor: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  },
  projectManager: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  },
  site: {
    select: {
      id: true,
      name: true,
      address: true,
      project: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
} satisfies Prisma.GeneralSupervisorSiteScopeSelect;

type ScopeRow = Prisma.GeneralSupervisorSiteScopeGetPayload<{ select: typeof scopeSelect }>;

export function canManageGeneralSupervisorScopes(role: Role) {
  return SCOPE_MANAGEMENT_ROLES.includes(role);
}

export function canReadGeneralSupervisorScopes(role: Role) {
  return SCOPE_WEB_READ_ROLES.includes(role);
}

export function generalSupervisorPlanningSiteWhere(user: AuthLikeUser, date: Date): Prisma.SiteWhereInput {
  return {
    status: SiteStatus.ACTIVE,
    generalSupervisorScopes: {
      some: {
        generalSupervisorId: user.id,
        status: GeneralSupervisorSiteScopeStatus.ACTIVE,
        startDate: {
          lte: date,
        },
        OR: [{ endDate: null }, { endDate: { gte: date } }],
      },
    },
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

  const [scopes, generalSupervisors, sites] = await Promise.all([
    prisma.generalSupervisorSiteScope.findMany({
      where: {
        site: siteWhere,
        ...(user.role === Role.GENERAL_SUPERVISOR ? { generalSupervisorId: user.id } : {}),
      },
      orderBy: [{ status: 'asc' }, { site: { project: { name: 'asc' } } }, { site: { name: 'asc' } }, { startDate: 'desc' }],
      select: scopeSelect,
    }),
    prisma.user.findMany({
      where: {
        role: Role.GENERAL_SUPERVISOR,
        isActive: true,
        ...(user.role === Role.GENERAL_SUPERVISOR ? { id: user.id } : {}),
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
      },
    }),
    prisma.site.findMany({
      where: siteWhere,
      orderBy: [{ project: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        address: true,
        project: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
  ]);

  return {
    scopes: scopes.map(serializeScope),
    generalSupervisors,
    sites,
  };
}

export async function createGeneralSupervisorScope(
  prisma: PrismaClient,
  user: AuthLikeUser,
  body: unknown,
): Promise<{ scope: GeneralSupervisorScopeItem } | Response> {
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

  const [site, generalSupervisor] = await Promise.all([
    prisma.site.findFirst({
      where: {
        id: input.siteId,
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
    }),
    prisma.user.findFirst({
      where: {
        id: input.generalSupervisorId,
        role: Role.GENERAL_SUPERVISOR,
        isActive: true,
      },
      select: { id: true },
    }),
  ]);

  if (!site) {
    return jsonScopeError('SITE_NOT_FOUND', 'Chantier introuvable dans votre perimetre.', 404);
  }

  if (!generalSupervisor) {
    return jsonScopeError('GENERAL_SUPERVISOR_NOT_FOUND', 'Superviseur general invalide.', 404);
  }

  const duplicate = await prisma.generalSupervisorSiteScope.findFirst({
    where: {
      generalSupervisorId: input.generalSupervisorId,
      siteId: input.siteId,
      startDate,
      status: GeneralSupervisorSiteScopeStatus.ACTIVE,
    },
    select: { id: true },
  });

  if (duplicate) {
    return jsonScopeError('SCOPE_CONFLICT', 'Ce site est deja confie a ce superviseur general pour cette date.', 409);
  }

  try {
    const scope = await prisma.generalSupervisorSiteScope.create({
      data: {
        generalSupervisorId: input.generalSupervisorId,
        projectManagerId: site.project.projectManagerId,
        siteId: input.siteId,
        startDate,
        endDate,
        status: GeneralSupervisorSiteScopeStatus.ACTIVE,
      },
      select: scopeSelect,
    });

    return { scope: serializeScope(scope) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return jsonScopeError('SCOPE_CONFLICT', 'Ce perimetre existe deja.', 409);
    }

    throw error;
  }
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

  const existing = await prisma.generalSupervisorSiteScope.findFirst({
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

  if (!existing) {
    return jsonScopeError('NOT_FOUND', 'Perimetre introuvable.', 404);
  }

  const startDate = input.startDate ? parseDate(input.startDate) : existing.startDate;
  const endDate = input.endDate === undefined ? existing.endDate : input.endDate ? parseDate(input.endDate) : null;

  if (!startDate || (input.endDate && !endDate)) {
    return jsonScopeError('INVALID_DATE', 'Dates de perimetre invalides.', 400);
  }

  if (endDate && endDate < startDate) {
    return jsonScopeError('INVALID_DATE_RANGE', 'La date de fin doit etre posterieure a la date de debut.', 400);
  }

  const scope = await prisma.generalSupervisorSiteScope.update({
    where: { id: existing.id },
    data: {
      ...(input.startDate !== undefined ? { startDate } : {}),
      ...(input.endDate !== undefined ? { endDate } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
    select: scopeSelect,
  });

  return { scope: serializeScope(scope) };
}

export async function deactivateGeneralSupervisorScope(prisma: PrismaClient, user: AuthLikeUser, scopeId: string) {
  if (!canManageGeneralSupervisorScopes(user.role)) {
    return jsonScopeError('FORBIDDEN', 'Acces refuse a la gestion des perimetres.', 403);
  }

  const existing = await prisma.generalSupervisorSiteScope.findFirst({
    where: {
      id: scopeId,
      site: buildManageableSiteWhere(user),
    },
    select: { id: true },
  });

  if (!existing) {
    return jsonScopeError('NOT_FOUND', 'Perimetre introuvable.', 404);
  }

  await prisma.generalSupervisorSiteScope.update({
    where: { id: existing.id },
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
    ...(user.role === Role.PROJECT_MANAGER
      ? {
          project: {
            projectManagerId: user.id,
          },
        }
      : {}),
  };
}

function buildReadableSiteWhere(user: AuthLikeUser): Prisma.SiteWhereInput {
  if (user.role === Role.GENERAL_SUPERVISOR) {
    return {
      status: SiteStatus.ACTIVE,
      generalSupervisorScopes: {
        some: {
          generalSupervisorId: user.id,
        },
      },
    };
  }

  return buildManageableSiteWhere(user);
}

function parseCreateScopeInput(body: unknown): CreateGeneralSupervisorScopeRequest | null {
  if (!isRecord(body)) return null;

  const generalSupervisorId = getString(body.generalSupervisorId);
  const siteId = getString(body.siteId);
  const startDate = getString(body.startDate);
  const endDate = getNullableString(body.endDate);

  if (!generalSupervisorId || !siteId || !startDate) {
    return null;
  }

  return endDate === undefined
    ? { generalSupervisorId, siteId, startDate }
    : { generalSupervisorId, siteId, startDate, endDate };
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

function serializeScope(scope: ScopeRow): GeneralSupervisorScopeItem {
  return {
    id: scope.id,
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

function getNullableString(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return getString(value);
}

function isScopeStatus(value: unknown): value is GeneralSupervisorSiteScopeStatus {
  return (
    value === GeneralSupervisorSiteScopeStatus.ACTIVE ||
    value === GeneralSupervisorSiteScopeStatus.INACTIVE
  );
}
