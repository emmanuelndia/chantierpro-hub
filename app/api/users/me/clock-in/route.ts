import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  findOpenSessionFromRecords,
  getTodayClockInRecordsForUser,
  isTechnician,
  jsonClockInError,
  serializeActiveSession,
  serializeTodayClockInView,
} from '@/lib/clock-in';

export const GET = withAuth(async ({ user }) => {
  if (!isTechnician(user.role)) {
    return jsonClockInError(
      'PERMISSION_DENIED',
      403,
      'Seuls les roles terrain peuvent consulter leur vue de pointage du jour.',
    );
  }

  const records = await getTodayClockInRecordsForUser(prisma, user.id);
  const date = new Date().toISOString().slice(0, 10);
  const openSession = findOpenSessionFromRecords(
    [...records]
      .sort((left, right) => left.timestampLocal.getTime() - right.timestampLocal.getTime())
      .map((record) => ({
        id: record.id,
        siteId: record.siteId,
        type: record.type,
        status: record.status,
        timestampLocal: record.timestampLocal,
        site: {
          name: record.site.name,
        },
      })),
  );

  return Response.json(
    serializeTodayClockInView({
      date,
      activeSession: serializeActiveSession(openSession),
      items: records,
    }),
  );
});
