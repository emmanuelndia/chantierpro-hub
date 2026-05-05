import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canAccessRh,
  getRhPresenceDetailForUser,
  jsonRhError,
  parseUserPresenceQuery,
} from '@/lib/rh';

export const GET = withAuth<{ userId: string }>(async ({ params, req, user }) => {
  if (!canAccessRh(user.role)) {
    return jsonRhError('FORBIDDEN', 403, 'Acces refuse au detail des presences RH.');
  }

  const query = parseUserPresenceQuery(new URL(req.url).searchParams);
  const response = await getRhPresenceDetailForUser(prisma, {
    userId: params.userId,
    query,
  });

  if (!response) {
    return jsonRhError('NOT_FOUND', 404, 'Utilisateur introuvable.');
  }

  return Response.json(response);
});
