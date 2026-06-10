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
        freeMissionId: record.freeMissionId,
        officeLocationId: record.officeLocationId,
        officeClockInLocation: record.officeClockInLocation,
        userId: record.userId,
        type: record.type,
        status: record.status,
        timestampLocal: record.timestampLocal,
        site: record.site ? { name: record.site.name } : null,
        freeMission: record.freeMission ? { action: record.freeMission.action } : null,
        officeLocation: record.officeLocation ? { name: record.officeLocation.name } : null,
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
