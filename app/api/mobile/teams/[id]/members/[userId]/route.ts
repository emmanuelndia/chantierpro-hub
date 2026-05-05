import { withAuth } from '@/lib/auth/with-auth';
import { canMutateMobileTeams, getScopedMobileTeamById } from '@/lib/mobile-teams';
import { prisma } from '@/lib/prisma';
import { jsonTeamError, softDeleteTeamMember } from '@/lib/teams';

export const DELETE = withAuth<{ id: string; userId: string }>(async ({ params, user }) => {
  if (!canMutateMobileTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, 'Accès refusé au retrait de membre.');
  }

  const team = await getScopedMobileTeamById(prisma, params.id, user);

  if (!team) {
    return jsonTeamError('NOT_FOUND', 404, 'Équipe introuvable.');
  }

  if (team.teamLeadId === params.userId) {
    return jsonTeamError(
      'TEAM_LEAD_REMOVAL_FORBIDDEN',
      400,
      "Impossible de retirer le chef d'équipe actif sans définir un nouveau leader.",
    );
  }

  const deleted = await prisma.$transaction((tx) =>
    softDeleteTeamMember(tx, {
      teamId: team.id,
      userId: params.userId,
    }),
  );

  if (!deleted) {
    return jsonTeamError('NOT_FOUND', 404, 'Membre actif introuvable dans cette équipe.');
  }

  return new Response(null, { status: 204 });
});
