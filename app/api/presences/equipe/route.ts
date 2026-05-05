import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canAccessTeamPresences,
  getTeamPresences,
  jsonTeamPresencesError,
  parseTeamPresencesQuery,
} from '@/lib/team-presences';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessTeamPresences(user.role)) {
    return jsonTeamPresencesError('FORBIDDEN', 403, 'Acces refuse aux presences equipe.');
  }

  const query = parseTeamPresencesQuery(new URL(req.url).searchParams);

  if (!query) {
    return jsonTeamPresencesError('BAD_REQUEST', 400, 'Les filtres de presences equipe sont invalides.');
  }

  const response = await getTeamPresences(prisma, user, query);
  return Response.json(response);
});
