import { NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  getUserByIdOrNull,
  jsonUserError,
  parseJsonBody,
  parseUpdateUserStatusInput,
  revokeUserSessions,
  serializeUserDetail,
  userPublicSelect,
} from '@/lib/users';
import { withAuth } from '@/lib/auth/with-auth';

export const PATCH = withAuth<{ id: string }>(
  async ({ params, req, user }) => {
    const body = await parseJsonBody<unknown>(req);
    const input = parseUpdateUserStatusInput(body);

    if (!input) {
      return jsonUserError('BAD_REQUEST', 400, 'Le payload de statut est invalide.');
    }

    if (user.id === params.id && input.isActive === false) {
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

    const updatedUser = await prisma.user.update({
      where: { id: params.id },
      data: {
        isActive: input.isActive,
      },
      select: userPublicSelect,
    });

    if (!input.isActive) {
      await revokeUserSessions(prisma, params.id);
    }

    return NextResponse.json({ user: serializeUserDetail(updatedUser) });
  },
  [Role.ADMIN],
);
