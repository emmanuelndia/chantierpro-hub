import { Role, SiteStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canReadProjects,
  getScopedProjectById,
  jsonProjectError,
  summarizePresences,
} from '@/lib/projects';

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

type PresenceRecord = {
  userId: string;
  type: 'ARRIVAL' | 'DEPARTURE' | 'INTERMEDIATE' | 'PAUSE_START' | 'PAUSE_END';
  timestampLocal: Date;
  latitude: { toNumber(): number } | null;
  longitude: { toNumber(): number } | null;
  accuracy: { toNumber(): number } | null;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    role: Role;
  };
};

function buildPresenceWorkers(records: PresenceRecord[]) {
  const present = new Map<string, ReturnType<typeof buildPresenceWorker>>();

  for (const record of records) {
    if (record.type === 'ARRIVAL' || record.type === 'INTERMEDIATE' || record.type === 'PAUSE_START' || record.type === 'PAUSE_END') {
      present.set(record.userId, buildPresenceWorker(record, records));
      continue;
    }

    if (record.type === 'DEPARTURE') {
      present.delete(record.userId);
    }
  }

  return [...present.values()];
}

function buildPresenceWorker(record: PresenceRecord, records: PresenceRecord[]) {
  const userRecords = records.filter((item) => item.userId === record.userId);
  const arrival = userRecords.find((item) => item.type === 'ARRIVAL') ?? null;
  const departure = [...userRecords].reverse().find((item) => item.type === 'DEPARTURE') ?? null;

  return {
    userId: record.user.id,
    firstName: record.user.firstName,
    lastName: record.user.lastName,
    role: record.user.role,
    gpsPointage: {
      arrivalAt: arrival?.timestampLocal.toISOString() ?? null,
      arrivalLatitude: arrival?.latitude?.toNumber() ?? null,
      arrivalLongitude: arrival?.longitude?.toNumber() ?? null,
      arrivalAccuracy: arrival?.accuracy?.toNumber() ?? null,
      departureAt: departure?.timestampLocal.toISOString() ?? null,
      departureLatitude: departure?.latitude?.toNumber() ?? null,
      departureLongitude: departure?.longitude?.toNumber() ?? null,
      departureAccuracy: departure?.accuracy?.toNumber() ?? null,
    },
  };
}

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canReadProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Acces refuse aux presences.');
  }

  const project = await getScopedProjectById(prisma, params.id, user);

  if (!project) {
    return jsonProjectError('NOT_FOUND', 404, 'Projet introuvable.');
  }

  const today = toDateOnly(new Date());
  const presenceDate = new Date(`${today}T00:00:00.000Z`);
  const [sites, freeMissions] = await Promise.all([
    prisma.site.findMany({
      where: {
        projectId: project.id,
      },
      select: {
        id: true,
        name: true,
        status: true,
        clockInRecords: {
          where: {
            clockInDate: presenceDate,
            status: 'VALID',
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          userId: true,
          type: true,
          timestampLocal: true,
          latitude: true,
          longitude: true,
          accuracy: true,
          user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                role: true,
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
    prisma.freeMission.findMany({
      where: {
        projectId: project.id,
        date: presenceDate,
        deletedAt: null,
      },
      select: {
        id: true,
        action: true,
        clockInRecords: {
          where: {
            clockInDate: presenceDate,
            status: 'VALID',
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            userId: true,
            type: true,
            timestampLocal: true,
            latitude: true,
            longitude: true,
            accuracy: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                role: true,
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }),
  ]);

  const summary = summarizePresences({
    projectId: project.id,
    date: today,
    sites: [
      ...sites.map((site) => {
      return {
        id: site.id,
        name: site.name,
        status: site.status,
        contextType: 'SITE' as const,
        contextLabel: 'Chantier',
        workers: buildPresenceWorkers(site.clockInRecords),
      };
      }),
      ...freeMissions.map((mission) => {
        return {
          id: mission.id,
          name: mission.action,
          status: SiteStatus.ACTIVE,
          contextType: 'FREE_MISSION' as const,
          contextLabel: 'Mission libre',
          workers: buildPresenceWorkers(mission.clockInRecords),
        };
      }),
    ],
  });

  return Response.json(summary);
});
