import { SiteStatus } from '@prisma/client';
import { withAuth } from '@/lib/auth/with-auth';
import { getSiteMapData, canAccessSiteMap } from '@/lib/site-map';
import { prisma } from '@/lib/prisma';
import { jsonProjectError } from '@/lib/projects';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessSiteMap(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Acces refuse a la cartographie des sites.');
  }

  const searchParams = req.nextUrl.searchParams;
  const rawStatus = searchParams.get('status');
  const status = rawStatus && Object.values(SiteStatus).includes(rawStatus as SiteStatus) ? (rawStatus as SiteStatus) : null;

  return Response.json(
    await getSiteMapData(prisma, user, {
      projectId: searchParams.get('projectId'),
      projectManagerId: searchParams.get('projectManagerId'),
      q: searchParams.get('q'),
      status,
    }),
  );
});