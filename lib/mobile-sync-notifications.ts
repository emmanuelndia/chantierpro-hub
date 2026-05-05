import { Role, type ClockInType, type PrismaClient } from '@prisma/client';

type NotifyPayload = {
  siteId: string;
  userId: string;
  type: ClockInType;
  errorCode: string;
  message: string;
  recordId: string;
};

export async function notifyClockInSyncAnomaly(prisma: PrismaClient, payload: NotifyPayload) {
  try {
    const [site, resource] = await Promise.all([
      prisma.site.findUnique({
        where: { id: payload.siteId },
        select: {
          name: true,
          project: {
            select: {
              projectManagerId: true,
            },
          },
          teams: {
            where: {
              status: 'ACTIVE',
            },
            select: {
              members: {
                where: {
                  status: 'ACTIVE',
                  user: {
                    role: {
                      in: [Role.COORDINATOR, Role.GENERAL_SUPERVISOR],
                    },
                  },
                },
                select: {
                  userId: true,
                },
              },
            },
          },
        },
      }),
      prisma.user.findUnique({
        where: { id: payload.userId },
        select: {
          firstName: true,
          lastName: true,
        },
      }),
    ]);

    const recipientIds = new Set<string>([payload.userId]);

    if (site?.project.projectManagerId) {
      recipientIds.add(site.project.projectManagerId);
    }

    for (const team of site?.teams ?? []) {
      for (const member of team.members) {
        recipientIds.add(member.userId);
      }
    }

    const tokens = await prisma.pushToken.findMany({
      where: {
        userId: {
          in: [...recipientIds],
        },
      },
      select: {
        token: true,
        platform: true,
        userId: true,
      },
    });

    const webhookUrl = process.env.PUSH_WEBHOOK_URL?.trim();

    if (!webhookUrl || tokens.length === 0) {
      return {
        status: webhookUrl ? 'no_push_token' : 'no_push_provider',
        tokenCount: tokens.length,
      };
    }

    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event: 'CLOCK_IN_SYNC_ANOMALY',
        recipients: tokens,
        title: 'Anomalie de pointage',
        body: `${resource?.firstName ?? 'Ressource'} ${resource?.lastName ?? ''} - ${site?.name ?? 'Chantier'}`,
        data: payload,
      }),
    });

    return {
      status: 'queued',
      tokenCount: tokens.length,
    };
  } catch {
    return {
      status: 'failed',
      tokenCount: 0,
    };
  }
}
