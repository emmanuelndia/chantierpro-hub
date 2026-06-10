import { NextResponse } from 'next/server';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  BUSINESS_MANAGER_ROLES,
  FIELD_USER_ROLES,
  getBusinessManagedResourceRoles,
  isBusinessManagerRole,
} from '@/lib/field-roles';
import {
  USERS_PAGE_SIZE,
  buildUserListWhere,
  createManagedUser,
  jsonUserError,
  parseCreateUserInput,
  parseJsonBody,
  parseUserListQuery,
  serializePaginatedUsers,
  serializeUserWithAvailability,
  userPublicSelect,
} from '@/lib/users';
import { withAuth } from '@/lib/auth/with-auth';
import type { UserAvailability } from '@/types/users';

export const GET = withAuth(
  async ({ req, user }) => {
    const query = parseUserListQuery(req.nextUrl.searchParams);

    if (!query) {
      return jsonUserError('BAD_REQUEST', 400, 'Les filtres utilisateurs sont invalides.');
    }

    if (!canReadUserList(user.role, query.role, query.roles, query.status)) {
      return jsonUserError('INVALID_ROLE', 403, 'Acces aux utilisateurs refuse pour ce filtre.');
    }

    const where = buildUserListWhere(query);
    const pageSize = query.limit ?? USERS_PAGE_SIZE;

    const [items, totalItems] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * pageSize,
        take: pageSize,
        select: userPublicSelect,
      }),
      prisma.user.count({ where }),
    ]);

    if (query.withAvailability) {
      const targetDate = query.availabilityDate ?? new Date().toISOString().slice(0, 10);
      const availability = await loadUserAvailability(targetDate, items.map((item) => item.id));

      return NextResponse.json({
        ...serializePaginatedUsers({
          items: [],
          page: query.page,
          totalItems,
          pageSize,
        }),
        items: items.map((item) =>
          serializeUserWithAvailability(item, availability.get(item.id) ?? buildAvailableUserAvailability(targetDate)),
        ),
      });
    }

    return NextResponse.json(
      serializePaginatedUsers({
        items,
        page: query.page,
        totalItems,
        pageSize,
      }),
    );
  },
  [Role.ADMIN, Role.DIRECTION, Role.GENERAL_SUPERVISOR, ...BUSINESS_MANAGER_ROLES, Role.PROJECT_MANAGER, Role.COORDINATOR],
);

export const POST = withAuth(
  async ({ req }) => {
    const body = await parseJsonBody<unknown>(req);
    const input = parseCreateUserInput(body);

    if (!input) {
      return jsonUserError('BAD_REQUEST', 400, 'Le payload utilisateur est invalide.');
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username: input.username },
          ...(input.email ? [{ email: input.email }] : []),
          ...(input.matricule ? [{ matricule: input.matricule }] : []),
        ],
      },
      select: { id: true, username: true, email: true, matricule: true },
    });

    if (existingUser) {
      return jsonUserError('CONFLICT', 409, 'Un utilisateur avec cet identifiant, cet email ou ce matricule existe deja.');
    }

    try {
      const payload = await createManagedUser(prisma, input);
      return NextResponse.json(payload, { status: 201 });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return jsonUserError('CONFLICT', 409, 'Un utilisateur avec cet identifiant, cet email ou ce matricule existe deja.');
      }

      throw error;
    }
  },
  [Role.ADMIN],
);

function canReadUserList(
  userRole: Role,
  roleFilter: Role | null,
  rolesFilter: Role[],
  status: 'active' | 'inactive' | 'all',
) {
  if (userRole === Role.ADMIN) {
    return true;
  }

  if (status !== 'active') {
    return false;
  }

  if (isBusinessManagerRole(userRole)) {
    const allowedRoles = getBusinessManagedResourceRoles(userRole);
    if (rolesFilter.length > 0) {
      return rolesFilter.every((role) => allowedRoles.includes(role));
    }

    return Boolean(roleFilter && allowedRoles.includes(roleFilter));
  }

  if (rolesFilter.length > 0) {
    return rolesFilter.every((role) => FIELD_USER_ROLES.includes(role));
  }

  return Boolean(roleFilter && FIELD_USER_ROLES.includes(roleFilter));
}

async function loadUserAvailability(dateValue: string, userIds: string[]) {
  const availability = new Map<string, UserAvailability>();

  if (userIds.length === 0) {
    return availability;
  }

  const date = new Date(`${dateValue}T00:00:00.000Z`);
  const assignments = await prisma.planningAssignment.findMany({
    where: {
      date,
      deletedAt: null,
      supervisorId: {
        in: userIds,
      },
    },
    orderBy: [{ site: { name: 'asc' } }, { id: 'asc' }],
    select: {
      id: true,
      supervisorId: true,
      siteId: true,
      site: {
        select: {
          name: true,
        },
      },
    },
  });

  for (const assignment of assignments) {
    if (availability.has(assignment.supervisorId)) {
      continue;
    }

    availability.set(assignment.supervisorId, {
      status: 'ASSIGNED',
      label: `Assigne sur ${assignment.site.name}`,
      date: dateValue,
      assignmentId: assignment.id,
      siteId: assignment.siteId,
      siteName: assignment.site.name,
    });
  }

  for (const userId of userIds) {
    if (!availability.has(userId)) {
      availability.set(userId, buildAvailableUserAvailability(dateValue));
    }
  }

  return availability;
}

function buildAvailableUserAvailability(dateValue: string | null): UserAvailability {
  return {
    status: 'AVAILABLE',
    label: 'Disponible',
    date: dateValue,
    assignmentId: null,
    siteId: null,
    siteName: null,
  };
}
