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
  const sites = await prisma.site.findMany({
    where: {
      OR: [
        {
          clockInRecords: {
            some: {
              userId: user.id,
              clockInDate: new Date(`${today}T00:00:00.000Z`),
              status: 'VALID',
            },
          },
        },
        {
          teams: {
            some: {
              members: {
                some: {
                  userId: user.id,
                  status: 'ACTIVE',
                },
              },
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
      clockInRecords: {
        where: {
          userId: user.id,
          clockInDate: new Date(`${today}T00:00:00.000Z`),
          status: 'VALID',
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          type: true,
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  const items = serializeTodaySiteItems(
    sites.map((site) => {
      let hasOpenSession = false;

      for (const record of site.clockInRecords) {
        if (record.type === 'ARRIVAL' || record.type === 'INTERMEDIATE') {
          hasOpenSession = true;
          continue;
        }

        if (record.type === 'DEPARTURE') {
          hasOpenSession = false;
        }
      }

      return {
        id: site.id,
        projectId: site.projectId,
        name: site.name,
        address: site.address,
        latitude: site.latitude,
        longitude: site.longitude,
        radiusKm: site.radiusKm,
        status: site.status,
        hasOpenSession,
      };
    }),
  );

  return Response.json({
    date: today,
    items,
  });
});
