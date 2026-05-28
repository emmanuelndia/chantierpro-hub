import { NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  deactivateManagedUser,
  getUserByIdOrNull,
  jsonUserError,
  parseJsonBody,
  parseUpdateUserInput,
  serializeUserDetail,
  userPublicSelect,
} from '@/lib/users';
import { withAuth } from '@/lib/auth/with-auth';

export const GET = withAuth<{ id: string }>(
  async ({ params }) => {
    const user = await getUserByIdOrNull(prisma, params.id);

    if (!user) {
      return jsonUserError('NOT_FOUND', 404, 'Utilisateur introuvable.');
    }
    

    return NextResponse.json({ user: serializeUserDetail(user) });
  },
  [Role.ADMIN],
);

export const PUT = withAuth<{ id: string }>(
  async ({ params, req }) => {
    const body = await parseJsonBody<unknown>(req);

    const input = parseUpdateUserInput(body); 

    if (!input) {
      return jsonUserError('BAD_REQUEST', 400, 'Le payload utilisateur est invalide.');
    }

    const existingUser = await getUserByIdOrNull(prisma, params.id);

    if (!existingUser) {
      return jsonUserError('NOT_FOUND', 404, 'Utilisateur introuvable.');
    }

    const conflictingUser = await prisma.user.findFirst({
      where: {
        id: { not: params.id },
        OR: [
          { username: input.username },
          ...(input.email ? [{ email: input.email }] : []),
        ],
      },
      select: { id: true },
    });

    if (conflictingUser) {
      return jsonUserError('CONFLICT', 409, 'Un utilisateur avec cet identifiant ou cet email existe deja.');
    }

    const updatedUser = await prisma.user.update({
      where: { id: params.id },
      data: input,
      select: userPublicSelect,
    });

    return NextResponse.json({ user: serializeUserDetail(updatedUser) });
  },
  [Role.ADMIN],
);

export const DELETE = withAuth<{ id: string }>(
  async ({ params, user }) => {
    if (user.id === params.id) {
      return jsonUserError(
        'SELF_DEACTIVATION_FORBIDDEN',
        400,
        "Un administrateur ne peut pas se desactiver lui-meme.",
      );
    }

    const existingUser = await getUserByIdOrNull(prisma, params.id);

    if (!existingUser) {
      return jsonUserError('NOT_FOUND', 404, 'Utilisateur introuvable.');
    }

    const updatedUser = await deactivateManagedUser(prisma, params.id);

    return NextResponse.json({
      user: serializeUserDetail(updatedUser),
      softDeleted: true,
    });
  },
  [Role.ADMIN],
);
