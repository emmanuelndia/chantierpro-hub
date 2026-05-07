import { ClockInStatus, ClockInType, SiteStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { isTechnician } from '@/lib/clock-in';
import { jsonProjectError, serializeTodaySiteItems } from '@/lib/projects';

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export const GET = withAuth(async ({ user }) => {
  if (!isTechnician(user.role)) {
    return jsonProjectError(
      'TECHNICIAN_ONLY',
      403,
      'Cette route est reservee aux roles terrain connectes.',
    );
  }

  const today = toDateOnly(new Date());
  const todayDate = new Date(`${today}T00:00:00.000Z`);
  const sites = await prisma.site.findMany({
    where: {
      OR: [
        {
          status: SiteStatus.ACTIVE,
          planningAssignments: {
            some: {
              supervisorId: user.id,
              date: todayDate,
              deletedAt: null,
            },
          },
        },
        {
          clockInRecords: {
            some: {
              userId: user.id,
              clockInDate: todayDate,
              status: ClockInStatus.VALID,
            },
          },
        },
      ],
    },
    select: {
      id: true,
      projectId: true,
      name: true,
      address: true,
      latitude: true,
      longitude: true,
      radiusKm: true,
      status: true,
      planningAssignments: {
        where: {
          supervisorId: user.id,
          date: todayDate,
          deletedAt: null,
        },
        select: {
          id: true,
        },
      },
      clockInRecords: {
        where: {
          userId: user.id,
          clockInDate: todayDate,
          status: ClockInStatus.VALID,
        },
        orderBy: [{ timestampLocal: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: {
          type: true,
        },
      },
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });

  const items = serializeTodaySiteItems(
    sites.flatMap((site) => {
      const hasOpenSession = hasOpenClockInSession(site.clockInRecords);
      const assignmentIds = site.planningAssignments.map((assignment) => assignment.id);

      if (assignmentIds.length === 0 && !hasOpenSession) {
        return [];
      }

      return [{
        id: site.id,
        projectId: site.projectId,
        name: site.name,
        address: site.address,
        latitude: site.latitude,
        longitude: site.longitude,
        radiusKm: site.radiusKm,
        status: site.status,
        hasOpenSession,
        assignmentIds,
        source: assignmentIds.length > 0 ? 'PLANNING' : 'OPEN_SESSION',
      }];
    }),
  );

  return Response.json({
    date: today,
    items,
  });
});

function hasOpenClockInSession(records: { type: ClockInType }[]) {
  let hasOpenSession = false;

  for (const record of records) {
    if (record.type === ClockInType.DEPARTURE) {
      hasOpenSession = false;
      continue;
    }

    hasOpenSession = true;
  }

  return hasOpenSession;
}
