import { withAuth } from '@/lib/auth/with-auth';
import { canMutateMobileTeams, getMobileTeamFormOptions } from '@/lib/mobile-teams';
import { prisma } from '@/lib/prisma';
import { jsonTeamError } from '@/lib/teams';

export const GET = withAuth(async ({ user }) => {
  if (!canMutateMobileTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, 'Accès refusé aux options équipe mobile.');
  }

  return Response.json(await getMobileTeamFormOptions(prisma, user));
});
