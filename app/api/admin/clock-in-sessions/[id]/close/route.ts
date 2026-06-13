import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { closeClockInSessionAsAdmin } from '@/lib/admin-clock-in-sessions';

export const POST = withAuth<{ id: string }>(async ({ params, user }) => {
  if (user.role !== Role.ADMIN) {
    return Response.json({ code: 'FORBIDDEN', message: 'Seul un administrateur peut fermer une session.' }, { status: 403 });
  }

  const result = await closeClockInSessionAsAdmin(prisma, {
    arrivalRecordId: params.id,
    adminUserId: user.id,
  });

  if (!result.ok) {
    return Response.json({ code: 'BAD_REQUEST', message: result.message }, { status: result.status });
  }

  return Response.json({ recordId: result.recordId }, { status: 201 });
});
