import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { listProjectFormOptions } from '@/lib/project-web';
import { canWriteSites, jsonProjectError } from '@/lib/projects';

export const GET = withAuth(async ({ user }) => {
  if (!canWriteSites(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Acces refuse aux options projet.');
  }

  return Response.json(await listProjectFormOptions(prisma, user));
});
