import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getSitePresences, parseSitePresencesQuery } from '@/lib/project-web';
import { canReadProjects, jsonProjectError } from '@/lib/projects';

export const GET = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canReadProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Acces refuse aux presences chantier.');
  }

  const query = parseSitePresencesQuery(req.nextUrl.searchParams);
  if (!query) {
    return jsonProjectError('BAD_REQUEST', 400, 'Les filtres de presences sont invalides.');
  }

  const presences = await getSitePresences(prisma, params.id, user, query);
  if (!presences) {
    return jsonProjectError('NOT_FOUND', 404, 'Chantier introuvable.');
  }

  return Response.json(presences);
});
