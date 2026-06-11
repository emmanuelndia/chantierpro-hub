import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  getClockInHistoryForUser,
  serializeClockInHistory,
} from '@/lib/clock-in';

export const GET = withAuth(async ({ user }) => {
  const records = await getClockInHistoryForUser(prisma, user.id);
  return Response.json({ items: serializeClockInHistory(records) });
});
