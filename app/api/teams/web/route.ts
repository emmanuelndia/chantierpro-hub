import { TeamStatus } from '@prisma/client';
import { withAuth } from '@/lib/auth/with-auth';
import { prisma } from '@/lib/prisma';
import { canAccessWebTeams, createWebTeam, getWebTeams } from '@/lib/web-teams';
import { jsonTeamError, parseJsonBody } from '@/lib/teams';
import type { WebTeamStatusFilter } from '@/types/web-teams';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessWebTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, 'Acces refuse aux equipes web.');
  }

  const searchParams = req.nextUrl.searchParams;
  const rawStatus = searchParams.get('status');
  const status =
    rawStatus && Object.values(TeamStatus).includes(rawStatus as TeamStatus)
      ? (rawStatus as WebTeamStatusFilter)
      : rawStatus === 'ALL'
        ? 'ALL'
        : null;

  const result = await getWebTeams(prisma, user, {
    projectId: searchParams.get('projectId'),
    siteId: searchParams.get('siteId'),
    status,
    q: searchParams.get('q'),
  });

  return result instanceof Response ? result : Response.json(result);
});

export const POST = withAuth(async ({ req, user }) => {
  if (!canAccessWebTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, "Acces refuse a la creation d'equipe.");
  }

  const body = await parseJsonBody<unknown>(req);
  const result = await createWebTeam(prisma, user, body);

  return result instanceof Response ? result : Response.json(result, { status: 201 });
});
