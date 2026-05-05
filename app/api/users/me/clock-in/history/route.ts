import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  getClockInHistoryForUser,
  isTechnician,
  jsonClockInError,
  serializeClockInHistory,
} from '@/lib/clock-in';

export const GET = withAuth(async ({ user }) => {
  if (!isTechnician(user.role)) {
    return jsonClockInError(
      'PERMISSION_DENIED',
      403,
      'Seuls les roles terrain peuvent consulter leur historique de pointage.',
    );
  }

  const records = await getClockInHistoryForUser(prisma, user.id);
  return Response.json({ items: serializeClockInHistory(records) });
});
