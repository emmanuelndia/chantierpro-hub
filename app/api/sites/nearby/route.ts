import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getNearbySites, isTechnician, jsonClockInError, parseNearbySiteQuery } from '@/lib/clock-in';

export const GET = withAuth(async ({ req, user }) => {
  if (!isTechnician(user.role)) {
    return jsonClockInError(
      'PERMISSION_DENIED',
      403,
      'Seuls les roles terrain peuvent detecter les chantiers proches.',
    );
  }

  const query = parseNearbySiteQuery(new URL(req.url).searchParams);

  if (!query) {
    return jsonClockInError('BAD_REQUEST', 400, 'Les parametres lat et lng sont invalides.');
  }

  const sites = await getNearbySites(prisma, query);

  if (sites.length === 0) {
    return Response.json({
      sites: [],
      message: 'OUTSIDE_ALL_SITES',
    });
  }

  return Response.json({ sites });
});
