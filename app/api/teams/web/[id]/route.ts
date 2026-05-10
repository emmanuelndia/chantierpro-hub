import { withAuth } from '@/lib/auth/with-auth';
import { prisma } from '@/lib/prisma';
import { canAccessWebTeams, getWebTeamDetail, updateWebTeam } from '@/lib/web-teams';
import { jsonTeamError, parseJsonBody } from '@/lib/teams';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canAccessWebTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, "Acces refuse au detail d'equipe web.");
  }

  const result = await getWebTeamDetail(prisma, user, params.id);
  return result instanceof Response ? result : Response.json(result);
});

export const PUT = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canAccessWebTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, "Acces refuse a la modification d'equipe.");
  }

  const body = await parseJsonBody<unknown>(req);
  const result = await updateWebTeam(prisma, user, params.id, body);

  return result instanceof Response ? result : Response.json(result);
});
