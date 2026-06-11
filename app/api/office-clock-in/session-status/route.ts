import { ClockInStatus, ClockInType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  findActivePauseFromRecords,
  findOpenSessionFromRecords,
  serializeSessionStatus,
} from '@/lib/clock-in';
import { withAuth } from '@/lib/auth/with-auth';

export const GET = withAuth(async ({ user }) => {
  const records = await prisma.clockInRecord.findMany({
    where: {
      userId: user.id,
      officeClockInLocation: 'OFFICE',
      status: ClockInStatus.VALID,
    },
    orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      siteId: true,
      freeMissionId: true,
      officeLocationId: true,
      officeClockInLocation: true,
      userId: true,
      type: true,
      status: true,
      timestampLocal: true,
      site: { select: { name: true } },
      freeMission: { select: { action: true } },
      officeLocation: { select: { name: true } },
    },
  });

  const openSession = findOpenSessionFromRecords(records);
  const activePause = findActivePauseFromRecords(
    records.filter((record) => record.type === ClockInType.PAUSE_START || record.type === ClockInType.PAUSE_END),
  );

  return Response.json(serializeSessionStatus(openSession, activePause));
});
