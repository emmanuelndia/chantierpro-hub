import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  jsonUserError,
  parseJsonBody,
  parseUpdateOwnProfileInput,
  serializeUserDetail,
  userPublicSelect,
} from '@/lib/users';
import { withAuth } from '@/lib/auth/with-auth';

export const GET = withAuth(async ({ user }) => {
  const currentUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: userPublicSelect,
  });

  if (!currentUser) {
    return jsonUserError('NOT_FOUND', 404, 'Utilisateur introuvable.');
  }

  return NextResponse.json({ user: serializeUserDetail(currentUser) });
});

export const PUT = withAuth(async ({ req, user }) => {
  const body = await parseJsonBody<unknown>(req);

  const input = parseUpdateOwnProfileInput(body);

  if (!input) {
    return jsonUserError('BAD_REQUEST', 400, 'Le payload du profil est invalide.');
  }

  if (input.email) {
    const existingUser = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    if (existingUser && existingUser.id !== user.id) {
      return jsonUserError('CONFLICT', 409, 'Cet email est deja utilise par un autre compte.');
    }
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: input,
    select: userPublicSelect,
  });

  return NextResponse.json({ user: serializeUserDetail(updatedUser) });
});
