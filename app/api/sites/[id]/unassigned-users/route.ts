import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canManageTeams,
  getScopedSiteByIdForTeams,
  jsonTeamError,
  listUnassignedTechnicians,
} from '@/lib/teams';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canManageTeams(user.role)) {
    return jsonTeamError(
      'FORBIDDEN',
      403,
      'Acces refuse a la liste des techniciens non assignes.',
    );
  }

  const site = await getScopedSiteByIdForTeams(prisma, params.id, user);

  if (!site) {
    return jsonTeamError('NOT_FOUND', 404, 'Chantier introuvable.');
  }

  const items = await listUnassignedTechnicians(prisma, site.id);

  return Response.json({ items });
});
