import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  jsonUserError,
  parseJsonBody,
  parseUpdateOwnProfileInput,
  serializeUserDetail,
  userPublicSelect,
  validateImmutableEmail,
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

  if (validateImmutableEmail(body)) {
    return jsonUserError(
      'EMAIL_IMMUTABLE',
      400,
      "L'email est l'identifiant unique et ne peut pas etre modifie.",
    );
  }

  const input = parseUpdateOwnProfileInput(body);

  if (!input) {
    return jsonUserError('BAD_REQUEST', 400, 'Le payload du profil est invalide.');
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: input,
    select: userPublicSelect,
  });

  return NextResponse.json({ user: serializeUserDetail(updatedUser) });
});
