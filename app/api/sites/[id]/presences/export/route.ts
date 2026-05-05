import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { buildSitePresencesCsv, parseSitePresencesQuery } from '@/lib/project-web';
import { canReadProjects, jsonProjectError } from '@/lib/projects';

export const GET = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canReadProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Acces refuse a l export des presences chantier.');
  }

  const query = parseSitePresencesQuery(req.nextUrl.searchParams);
  if (!query) {
    return jsonProjectError('BAD_REQUEST', 400, 'Les filtres de presences sont invalides.');
  }

  const artifact = await buildSitePresencesCsv(prisma, params.id, user, query);
  if (!artifact) {
    return jsonProjectError('NOT_FOUND', 404, 'Chantier introuvable.');
  }

  return new Response(Uint8Array.from(artifact.buffer), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${artifact.fileName}"`,
    },
  });
});
