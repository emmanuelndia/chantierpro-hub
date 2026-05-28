import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessRh, getSitePresencesLive, jsonRhError, parseSitePresenceLiveQuery } from '@/lib/rh';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessRh(user.role)) {
    return jsonRhError('FORBIDDEN', 403, 'Acces refuse aux presences chantier live.');
  }

  const query = parseSitePresenceLiveQuery(new URL(req.url).searchParams);
  const response = await getSitePresencesLive(prisma, query);
  return Response.json(response);
});
