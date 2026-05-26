import { ClockInStatus, ClockInType, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { FIELD_USER_ROLES } from '@/lib/field-roles';
import type { PendingSessionReportsResponse } from '@/types/mobile-session-report';

const allowedRoles: readonly Role[] = FIELD_USER_ROLES;

export const GET = withAuth(async ({ user }) => {
  if (!allowedRoles.includes(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const where = {
    userId: user.id,
    status: ClockInStatus.VALID,
    type: ClockInType.DEPARTURE,
    report: null,
  } as const;

  const [total, records] = await Promise.all([
    prisma.clockInRecord.count({ where }),
    prisma.clockInRecord.findMany({
      where,
      orderBy: [{ timestampLocal: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: {
        id: true,
        siteId: true,
        clockInDate: true,
        timestampLocal: true,
        site: {
          select: {
            name: true,
          },
        },
      },
    }),
  ]);

  const response: PendingSessionReportsResponse = {
    total,
    items: records.map((record) => ({
      departureRecordId: record.id,
      siteId: record.siteId,
      siteName: record.site.name,
      date: record.clockInDate.toISOString().slice(0, 10),
      endedAt: record.timestampLocal.toISOString(),
    })),
  };

  return Response.json(response);
});
