import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { listAdminClockInSessions, parseAdminClockInSessionQuery } from '@/lib/admin-clock-in-sessions';

export const GET = withAuth(async ({ req, user }) => {
  if (user.role !== Role.ADMIN) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces refuse aux sessions de pointage.' }, { status: 403 });
  }

  const query = parseAdminClockInSessionQuery(new URL(req.url).searchParams);
  const response = await listAdminClockInSessions(prisma, query);
  return Response.json(response);
});
