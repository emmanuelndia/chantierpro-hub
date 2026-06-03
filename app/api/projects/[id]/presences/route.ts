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
      const present = new Map<string, { userId: string; firstName: string; lastName: string; role: Role }>();

      for (const record of site.clockInRecords) {
        if (record.type === 'ARRIVAL' || record.type === 'INTERMEDIATE') {
          present.set(record.userId, {
            userId: record.user.id,
            firstName: record.user.firstName,
            lastName: record.user.lastName,
            role: record.user.role,
          });
          continue;
        }

        if (record.type === 'DEPARTURE') {
          present.delete(record.userId);
        }
      }

      return {
        id: site.id,
        name: site.name,
        status: site.status,
        contextType: 'SITE' as const,
        contextLabel: 'Chantier',
        workers: [...present.values()],
      };
      }),
      ...freeMissions.map((mission) => {
        const present = new Map<string, { userId: string; firstName: string; lastName: string; role: Role }>();

        for (const record of mission.clockInRecords) {
          if (record.type === 'ARRIVAL' || record.type === 'INTERMEDIATE' || record.type === 'PAUSE_START' || record.type === 'PAUSE_END') {
            present.set(record.userId, {
              userId: record.user.id,
              firstName: record.user.firstName,
              lastName: record.user.lastName,
              role: record.user.role,
            });
            continue;
          }

          if (record.type === 'DEPARTURE') {
            present.delete(record.userId);
          }
        }

        return {
          id: mission.id,
          name: mission.action,
          status: SiteStatus.ACTIVE,
          contextType: 'FREE_MISSION' as const,
          contextLabel: 'Mission libre',
          workers: [...present.values()],
        };
      }),
    ],
  });

  return Response.json(summary);
});
