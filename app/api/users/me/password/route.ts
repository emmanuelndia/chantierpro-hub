import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createExpiredRefreshCookie } from '@/lib/auth/cookies';
import { hashPassword } from '@/lib/auth/password';
import { withAuth } from '@/lib/auth/with-auth';
import {
  jsonUserError,
  parseChangePasswordInput,
  parseJsonBody,
  revokeUserSessions,
  verifyAndValidatePasswordChange,
} from '@/lib/users';

export const PUT = withAuth(async ({ req, user }) => {
  const body = await parseJsonBody<unknown>(req);
  const input = parseChangePasswordInput(body);

  if (!input) {
    return jsonUserError('BAD_REQUEST', 400, 'Le payload du mot de passe est invalide.');
  }

  const validationError = await verifyAndValidatePasswordChange(prisma, user.id, input);

  if (validationError) {
    return validationError;
  }

  const passwordHash = await hashPassword(input.newPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      mustChangePassword: false,
    },
  });

  await revokeUserSessions(prisma, user.id);

  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(createExpiredRefreshCookie());
  return response;
});
