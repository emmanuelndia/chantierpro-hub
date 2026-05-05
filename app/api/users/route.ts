import { NextResponse } from 'next/server';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  USERS_PAGE_SIZE,
  buildUserListWhere,
  createManagedUser,
  jsonUserError,
  parseCreateUserInput,
  parseJsonBody,
  parseUserListQuery,
  serializePaginatedUsers,
  userPublicSelect,
} from '@/lib/users';
import { withAuth } from '@/lib/auth/with-auth';

export const GET = withAuth(
  async ({ req }) => {
    const query = parseUserListQuery(req.nextUrl.searchParams);

    if (!query) {
      return jsonUserError('BAD_REQUEST', 400, 'Les filtres utilisateurs sont invalides.');
    }

    const where = buildUserListWhere(query);

    const [items, totalItems] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * USERS_PAGE_SIZE,
        take: USERS_PAGE_SIZE,
        select: userPublicSelect,
      }),
      prisma.user.count({ where }),
    ]);

    return NextResponse.json(
      serializePaginatedUsers({
        items,
        page: query.page,
        totalItems,
      }),
    );
  },
  [Role.ADMIN],
);

export const POST = withAuth(
  async ({ req }) => {
    const body = await parseJsonBody<unknown>(req);
    const input = parseCreateUserInput(body);

    if (!input) {
      return jsonUserError('BAD_REQUEST', 400, 'Le payload utilisateur est invalide.');
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    if (existingUser) {
      return jsonUserError('CONFLICT', 409, 'Un utilisateur avec cet email existe deja.');
    }

    try {
      const payload = await createManagedUser(prisma, input);
      return NextResponse.json(payload, { status: 201 });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return jsonUserError('CONFLICT', 409, 'Un utilisateur avec cet email existe deja.');
      }

      throw error;
    }
  },
  [Role.ADMIN],
);
