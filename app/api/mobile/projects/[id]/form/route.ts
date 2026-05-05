import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { listProjectFormOptions } from '@/lib/project-web';
import { canAccessMobileProjects } from '@/lib/mobile-projects';
import { getScopedProjectById, jsonProjectError, serializeProjectDetail } from '@/lib/projects';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canAccessMobileProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Accès refusé au formulaire projet mobile.');
  }

  const project = await getScopedProjectById(prisma, params.id, user);

  if (!project) {
    return jsonProjectError('NOT_FOUND', 404, 'Projet introuvable.');
  }

  const options = await listProjectFormOptions(prisma, user);

  return Response.json({
    project: serializeProjectDetail(project),
    options,
  });
});
