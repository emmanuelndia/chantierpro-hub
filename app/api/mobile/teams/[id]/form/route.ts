import { withAuth } from '@/lib/auth/with-auth';
import { canMutateMobileTeams, getMobileTeamForm } from '@/lib/mobile-teams';
import { prisma } from '@/lib/prisma';
import { jsonTeamError } from '@/lib/teams';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canMutateMobileTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, 'Accès refusé au formulaire équipe mobile.');
  }

  const form = await getMobileTeamForm(prisma, user, params.id);

  if (!form) {
    return jsonTeamError('NOT_FOUND', 404, 'Équipe introuvable.');
  }

  return Response.json(form);
});
