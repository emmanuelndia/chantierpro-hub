import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { listProjectFormOptions } from '@/lib/project-web';
import { canWriteProjects, jsonProjectError } from '@/lib/projects';

export const GET = withAuth(async ({ user }) => {
  if (!canWriteProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Acces refuse aux options projet.');
  }

  return Response.json(await listProjectFormOptions(prisma, user));
});
