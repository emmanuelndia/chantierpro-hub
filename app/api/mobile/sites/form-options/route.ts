import { withAuth } from '@/lib/auth/with-auth';
import { canAccessMobileSitesManagement, getMobileSiteFormOptions } from '@/lib/mobile-sites';
import { prisma } from '@/lib/prisma';
import { jsonProjectError } from '@/lib/projects';

export const GET = withAuth(async ({ user }) => {
  if (!canAccessMobileSitesManagement(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Accès refusé aux options chantier mobile.');
  }

  return Response.json(await getMobileSiteFormOptions(prisma, user));
});
