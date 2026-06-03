import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getFreeMissionSessionStatus } from '@/lib/free-missions';
import { isTechnician, jsonClockInError } from '@/lib/clock-in';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!isTechnician(user.role)) {
    return jsonClockInError('PERMISSION_DENIED', 403, 'Acces refuse au statut de mission libre.');
  }

  return getFreeMissionSessionStatus(prisma, user, params.id);
});
