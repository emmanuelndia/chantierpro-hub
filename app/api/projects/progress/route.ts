import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessProjectProgress, getProjectProgress } from '@/lib/project-progress';

export const GET = withAuth(async ({ user }) => {
  if (!canAccessProjectProgress(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces refuse a la progression projets.' }, { status: 403 });
  }

  return Response.json(await getProjectProgress(prisma, user));
});
