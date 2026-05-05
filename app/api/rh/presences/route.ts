import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessRh, getMonthlyRhPresences, jsonRhError, parseMonthlyPresenceQuery } from '@/lib/rh';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessRh(user.role)) {
    return jsonRhError('FORBIDDEN', 403, 'Acces refuse aux presences RH.');
  }

  const query = parseMonthlyPresenceQuery(new URL(req.url).searchParams);

  if (!query) {
    return jsonRhError('BAD_REQUEST', 400, 'Les parametres month et year sont invalides.');
  }

  const response = await getMonthlyRhPresences(prisma, query);
  return Response.json(response);
});
