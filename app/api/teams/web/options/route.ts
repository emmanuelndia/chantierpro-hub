import { withAuth } from '@/lib/auth/with-auth';
import { prisma } from '@/lib/prisma';
import { canAccessWebTeams, getWebTeamFormOptions } from '@/lib/web-teams';
import { jsonTeamError } from '@/lib/teams';

export const GET = withAuth(async ({ user }) => {
  if (!canAccessWebTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, 'Acces refuse aux options equipe web.');
  }

  const result = await getWebTeamFormOptions(prisma, user);
  return result instanceof Response ? result : Response.json(result);
});
