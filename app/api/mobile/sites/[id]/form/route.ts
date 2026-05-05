import { withAuth } from '@/lib/auth/with-auth';
import { canAccessMobileSitesManagement, getMobileSiteForm } from '@/lib/mobile-sites';
import { prisma } from '@/lib/prisma';
import { jsonProjectError } from '@/lib/projects';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canAccessMobileSitesManagement(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Accès refusé au formulaire chantier mobile.');
  }

  const form = await getMobileSiteForm(prisma, user, params.id);

  if (!form) {
    return jsonProjectError('NOT_FOUND', 404, 'Chantier introuvable.');
  }

  return Response.json(form);
});
