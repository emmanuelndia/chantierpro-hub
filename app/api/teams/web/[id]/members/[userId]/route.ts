import { withAuth } from '@/lib/auth/with-auth';
import { prisma } from '@/lib/prisma';
import { canAccessWebTeams, removeWebTeamMember } from '@/lib/web-teams';
import { jsonTeamError } from '@/lib/teams';

export const DELETE = withAuth<{ id: string; userId: string }>(async ({ params, user }) => {
  if (!canAccessWebTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, 'Acces refuse au retrait de membre.');
  }

  return removeWebTeamMember(prisma, user, params.id, params.userId);
});
