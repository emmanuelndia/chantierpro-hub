import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessRh, getRhOptions, jsonRhError } from '@/lib/rh';

export const GET = withAuth(async ({ user }) => {
  if (!canAccessRh(user.role)) {
    return jsonRhError('FORBIDDEN', 403, "Acces refuse aux options du module RH.");
  }

  return Response.json(await getRhOptions(prisma));
});
