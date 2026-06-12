import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  getOpenSessionForUser,
  getTodayClockInRecordsForUser,
  serializeActiveSession,
  serializeTodayClockInView,
} from '@/lib/clock-in';

export const GET = withAuth(async ({ user }) => {
  const records = await getTodayClockInRecordsForUser(prisma, user.id);
  const date = new Date().toISOString().slice(0, 10);
  const openSession = await getOpenSessionForUser(prisma, user.id);

  return Response.json(
    serializeTodayClockInView({
      date,
      activeSession: serializeActiveSession(openSession),
      items: records,
    }),
  );
});
