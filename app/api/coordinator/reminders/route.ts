import { ClockInStatus, ClockInType, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getOperationalSiteIds } from '@/lib/dashboard';

type ReminderBody = {
  clockInRecordId?: string;
};

export const POST = withAuth(async ({ req, user }) => {
  if (user.role !== Role.COORDINATOR) {
    return Response.json(
      { code: 'FORBIDDEN', message: 'Relance reservee aux coordinateurs.' },
      { status: 403 },
    );
  }

  let body: ReminderBody = {};

  try {
    body = JSON.parse(await req.text()) as ReminderBody;
  } catch {
    body = {};
  }

  const clockInRecordId = body.clockInRecordId?.trim();

  if (!clockInRecordId) {
    return Response.json(
      { code: 'BAD_REQUEST', message: 'Session a relancer manquante.' },
      { status: 400 },
    );
  }

  const siteIds = await getOperationalSiteIds(prisma, user.id);
  const record = await prisma.clockInRecord.findFirst({
    where: {
      id: clockInRecordId,
      siteId: {
        in: siteIds,
      },
      type: ClockInType.DEPARTURE,
      status: ClockInStatus.VALID,
      report: null,
      user: {
        role: Role.SUPERVISOR,
        isActive: true,
      },
    },
    select: {
      id: true,
      userId: true,
      site: {
        select: {
          name: true,
        },
      },
      user: {
        select: {
          firstName: true,
          lastName: true,
          pushTokens: {
            select: {
              id: true,
            },
          },
        },
      },
    },
  });

  if (!record) {
    return Response.json(
      { code: 'NOT_FOUND', message: 'Session sans rapport introuvable dans votre perimetre.' },
      { status: 404 },
    );
  }

  return Response.json({
    reminder: {
      clockInRecordId: record.id,
      supervisorId: record.userId,
      supervisorName: `${record.user.firstName} ${record.user.lastName}`,
      siteName: record.site.name,
      pushTokenCount: record.user.pushTokens.length,
      status: record.user.pushTokens.length > 0 ? 'queued' : 'no_push_token',
    },
  });
});
