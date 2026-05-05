import { SiteStatus } from '@prisma/client';
import { withAuth } from '@/lib/auth/with-auth';
import { getMobileSitesManagement, canAccessMobileSitesManagement } from '@/lib/mobile-sites';
import { prisma } from '@/lib/prisma';
import { jsonProjectError } from '@/lib/projects';
import type { MobileSiteStatusFilter } from '@/types/mobile-sites';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessMobileSitesManagement(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Accès refusé à la gestion mobile des chantiers.');
  }

  const searchParams = req.nextUrl.searchParams;
  const rawStatus = searchParams.get('status');
  const status =
    rawStatus && Object.values(SiteStatus).includes(rawStatus as SiteStatus)
      ? (rawStatus as MobileSiteStatusFilter)
      : null;

  return Response.json(
    await getMobileSitesManagement(prisma, user, {
      projectId: searchParams.get('projectId'),
      status,
      q: searchParams.get('q'),
    }),
  );
});
