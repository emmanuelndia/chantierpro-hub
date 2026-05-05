import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getProjectTeamSummary } from '@/lib/project-web';
import { canReadProjects, jsonProjectError } from '@/lib/projects';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canReadProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, "Acces refuse a l'equipe projet.");
  }

  const summary = await getProjectTeamSummary(prisma, params.id, user);
  if (!summary) {
    return jsonProjectError('NOT_FOUND', 404, 'Projet introuvable.');
  }

  return Response.json(summary);
});
