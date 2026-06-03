import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { clockInFreeMission } from '@/lib/free-missions';
import { isTechnician, jsonClockInError } from '@/lib/clock-in';

export const POST = withAuth<{ id: string }>(async ({ req, params, user }) => {
  if (!isTechnician(user.role)) {
    return jsonClockInError('PERMISSION_DENIED', 403, 'Seuls les roles terrain peuvent pointer sur une mission libre.');
  }

  return clockInFreeMission(prisma, user, params.id, req);
});
