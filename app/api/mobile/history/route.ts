import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canAccessMobileHistory,
  getMobileHistory,
  parseMobileHistoryQuery,
} from '@/lib/mobile-history';
import { jsonClockInError } from '@/lib/clock-in';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessMobileHistory(user.role)) {
    return jsonClockInError(
      'PERMISSION_DENIED',
      403,
      'Seuls les roles terrain peuvent consulter leur historique mobile.',
    );
  }

  const query = parseMobileHistoryQuery(new URL(req.url).searchParams);
  return Response.json(await getMobileHistory(prisma, user, query));
});
