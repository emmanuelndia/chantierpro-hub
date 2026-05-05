import { NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  getUserByIdOrNull,
  jsonUserError,
  parseJsonBody,
  parseUpdateUserInput,
  serializeUserDetail,
  validateImmutableEmail,
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

    if (validateImmutableEmail(body)) {
      return jsonUserError(
        'EMAIL_IMMUTABLE',
        400,
        "L'email est l'identifiant unique et ne peut pas etre modifie.",
      );
    }

    const input = parseUpdateUserInput(body);

    if (!input) {
      return jsonUserError('BAD_REQUEST', 400, 'Le payload utilisateur est invalide.');
    }

    const existingUser = await getUserByIdOrNull(prisma, params.id);

    if (!existingUser) {
      return jsonUserError('NOT_FOUND', 404, 'Utilisateur introuvable.');
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
