import { Prisma, Role, type PrismaClient } from '@prisma/client';
import type {
  CoordinatorProjectManagerScopeItem,
  CoordinatorProjectManagerScopesResponse,
  CreateCoordinatorProjectManagerScopeRequest,
} from '@/types/coordinator-project-manager-scopes';

type AuthLikeUser = {
  id: string;
  role: Role;
};

const MANAGEMENT_ROLES: readonly Role[] = [Role.PROJECT_MANAGER, Role.ADMIN];

const scopeSelect = {
  id: true,
  coordinatorId: true,
  projectManagerId: true,
  createdById: true,
  createdAt: true,
  coordinator: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true,
      email: true,
    },
  },
  projectManager: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true,
      email: true,
    },
  },
} satisfies Prisma.CoordinatorProjectManagerScopeSelect;

type ScopeRow = Prisma.CoordinatorProjectManagerScopeGetPayload<{ select: typeof scopeSelect }>;

export function canManageCoordinatorProjectManagerScopes(role: Role) {
  return MANAGEMENT_ROLES.includes(role);
}

export async function getCoordinatorProjectManagerScopes(
  prisma: PrismaClient,
  user: AuthLikeUser,
): Promise<CoordinatorProjectManagerScopesResponse | Response> {
  if (!canManageCoordinatorProjectManagerScopes(user.role)) {
    return jsonCoordinatorScopeError('FORBIDDEN', 'Acces refuse aux coordinateurs projet.', 403);
  }

  const [scopes, coordinators, projectManagers] = await Promise.all([
    prisma.coordinatorProjectManagerScope.findMany({
      where: buildScopeAccessWhere(user),
      orderBy: [{ projectManager: { firstName: 'asc' } }, { coordinator: { firstName: 'asc' } }, { createdAt: 'desc' }],
      select: scopeSelect,
    }),
    prisma.user.findMany({
      where: {
        role: Role.COORDINATOR,
        isActive: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
      select: userOptionSelect,
    }),
    prisma.user.findMany({
      where: {
        role: Role.PROJECT_MANAGER,
        isActive: true,
        ...(user.role === Role.PROJECT_MANAGER ? { id: user.id } : {}),
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }],
      select: userOptionSelect,
    }),
  ]);

  return {
    scopes: scopes.map(serializeScope),
    coordinators,
    projectManagers,
  };
}

export async function createCoordinatorProjectManagerScope(
  prisma: PrismaClient,
  user: AuthLikeUser,
  body: unknown,
): Promise<{ scope: CoordinatorProjectManagerScopeItem } | Response> {
  if (!canManageCoordinatorProjectManagerScopes(user.role)) {
    return jsonCoordinatorScopeError('FORBIDDEN', 'Acces refuse a la gestion des coordinateurs projet.', 403);
  }

  const input = parseCreateScopeInput(body);
  if (!input) {
    return jsonCoordinatorScopeError('BAD_REQUEST', 'Payload coordinateur projet invalide.', 400);
  }

  const projectManagerId = user.role === Role.PROJECT_MANAGER ? user.id : input.projectManagerId;
  if (!projectManagerId) {
    return jsonCoordinatorScopeError('PROJECT_MANAGER_REQUIRED', 'Chef projet requis.', 400);
  }

  const [coordinator, projectManager] = await Promise.all([
    prisma.user.findFirst({
      where: {
        id: input.coordinatorId,
        role: Role.COORDINATOR,
        isActive: true,
      },
      select: { id: true },
    }),
    prisma.user.findFirst({
      where: {
        id: projectManagerId,
        role: Role.PROJECT_MANAGER,
        isActive: true,
      },
      select: { id: true },
    }),
  ]);

  if (!coordinator) {
    return jsonCoordinatorScopeError('COORDINATOR_NOT_FOUND', 'Coordinateur actif introuvable.', 404);
  }

  if (!projectManager) {
    return jsonCoordinatorScopeError('PROJECT_MANAGER_NOT_FOUND', 'Chef projet actif introuvable.', 404);
  }

  try {
    const scope = await prisma.coordinatorProjectManagerScope.create({
      data: {
        coordinatorId: input.coordinatorId,
        projectManagerId,
        createdById: user.id,
      },
      select: scopeSelect,
    });

    return { scope: serializeScope(scope) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return jsonCoordinatorScopeError('SCOPE_CONFLICT', 'Ce coordinateur est deja rattache a ce chef projet.', 409);
    }

    throw error;
  }
}

export async function deleteCoordinatorProjectManagerScope(
  prisma: PrismaClient,
  user: AuthLikeUser,
  scopeId: string,
) {
  if (!canManageCoordinatorProjectManagerScopes(user.role)) {
    return jsonCoordinatorScopeError('FORBIDDEN', 'Acces refuse a la gestion des coordinateurs projet.', 403);
  }

  const existing = await prisma.coordinatorProjectManagerScope.findFirst({
    where: {
      id: scopeId,
      ...buildScopeAccessWhere(user),
    },
    select: { id: true },
  });

  if (!existing) {
    return jsonCoordinatorScopeError('NOT_FOUND', 'Rattachement coordinateur introuvable.', 404);
  }

  await prisma.coordinatorProjectManagerScope.delete({
    where: { id: existing.id },
  });

  return new Response(null, { status: 204 });
}

export function jsonCoordinatorScopeError(code: string, message: string, status: number) {
  return Response.json({ code, message }, { status });
}

const userOptionSelect = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
  email: true,
} satisfies Prisma.UserSelect;

function buildScopeAccessWhere(user: AuthLikeUser): Prisma.CoordinatorProjectManagerScopeWhereInput {
  if (user.role === Role.PROJECT_MANAGER) {
    return {
      projectManagerId: user.id,
    };
  }

  return {};
}

function serializeScope(scope: ScopeRow): CoordinatorProjectManagerScopeItem {
  return {
    id: scope.id,
    coordinatorId: scope.coordinatorId,
    projectManagerId: scope.projectManagerId,
    createdById: scope.createdById,
    createdAt: scope.createdAt.toISOString(),
    coordinator: scope.coordinator,
    projectManager: scope.projectManager,
  };
}

function parseCreateScopeInput(body: unknown): CreateCoordinatorProjectManagerScopeRequest | null {
  if (!isRecord(body)) {
    return null;
  }

  const coordinatorId = sanitizeString(body.coordinatorId);
  const projectManagerId = sanitizeString(body.projectManagerId);

  if (!coordinatorId) {
    return null;
  }

  return {
    coordinatorId,
    ...(projectManagerId ? { projectManagerId } : {}),
  };
}

function sanitizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
