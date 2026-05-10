import { withAuth } from '@/lib/auth/with-auth';
import { prisma } from '@/lib/prisma';
import { addWebTeamMember, canAccessWebTeams } from '@/lib/web-teams';
import { jsonTeamError, parseJsonBody } from '@/lib/teams';

export const POST = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canAccessWebTeams(user.role)) {
    return jsonTeamError('FORBIDDEN', 403, "Acces refuse a l'ajout de membre.");
  }

  const body = await parseJsonBody<unknown>(req);
  const result = await addWebTeamMember(prisma, user, params.id, body);

  return result instanceof Response ? result : Response.json(result, { status: result.reactivated ? 200 : 201 });
});
