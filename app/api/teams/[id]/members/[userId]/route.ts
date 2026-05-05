import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canManageTeams,
  getScopedTeamById,
  jsonTeamError,
  softDeleteTeamMember,
} from '@/lib/teams';

export const DELETE = withAuth<{ id: string; userId: string }>(async ({ params, user }) => {
  if (!canManageTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, 'Acces refuse au retrait de membre.');
  }

  const team = await getScopedTeamById(prisma, params.id, user);

  if (!team) {
    return jsonTeamError('NOT_FOUND', 404, 'Equipe introuvable.');
  }

  if (team.teamLeadId === params.userId) {
    return jsonTeamError(
      'TEAM_LEAD_REMOVAL_FORBIDDEN',
      400,
      "Impossible de retirer le chef d'equipe actif sans definir un nouveau leader.",
    );
  }

  const deleted = await prisma.$transaction((tx) =>
    softDeleteTeamMember(tx, {
      teamId: team.id,
      userId: params.userId,
    }),
  );

  if (!deleted) {
    return jsonTeamError('NOT_FOUND', 404, 'Membre actif introuvable dans cette equipe.');
  }

  return new Response(null, { status: 204 });
});
