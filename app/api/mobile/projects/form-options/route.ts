import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { listProjectFormOptions } from '@/lib/project-web';
import { canAccessMobileProjects } from '@/lib/mobile-projects';
import { jsonProjectError } from '@/lib/projects';

export const GET = withAuth(async ({ user }) => {
  if (!canAccessMobileProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Accès refusé aux options projet mobile.');
  }

  return Response.json(await listProjectFormOptions(prisma, user));
});
