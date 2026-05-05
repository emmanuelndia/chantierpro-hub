import { NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { PASSWORD_RESET_DEFAULT } from '@/lib/auth/constants';
import { hashPassword } from '@/lib/auth/password';
import { withAuth } from '@/lib/auth/with-auth';
import { getUserByIdOrNull, jsonUserError, revokeUserSessions } from '@/lib/users';

export const POST = withAuth<{ id: string }>(
  async ({ params }) => {
    const existingUser = await getUserByIdOrNull(prisma, params.id);

    if (!existingUser) {
      return jsonUserError('NOT_FOUND', 404, 'Utilisateur introuvable.');
    }

    const passwordHash = await hashPassword(PASSWORD_RESET_DEFAULT);

    await prisma.user.update({
      where: { id: params.id },
      data: {
        passwordHash,
        mustChangePassword: true,
      },
    });

    await revokeUserSessions(prisma, params.id);

    return new NextResponse(null, { status: 204 });
  },
  [Role.ADMIN],
);
