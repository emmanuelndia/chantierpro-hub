import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { closeClockInSessionAsAdmin } from '@/lib/admin-clock-in-sessions';
import { jsonRhError } from '@/lib/rh';

export const POST = withAuth(async ({ req, user }) => {
  if (user.role !== Role.ADMIN) {
    return jsonRhError('FORBIDDEN', 403, 'Seul un administrateur peut fermer une sortie oubliee.');
  }

  const body = (await req.json().catch((): unknown => null)) as unknown;
  if (!isRecord(body) || typeof body.arrivalRecordId !== 'string') {
    return jsonRhError('BAD_REQUEST', 400, 'Pointage entree obligatoire.');
  }

  const result = await closeClockInSessionAsAdmin(prisma, {
    arrivalRecordId: body.arrivalRecordId,
    adminUserId: user.id,
  });

  if (!result.ok) {
    return jsonRhError(result.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', result.status, result.message);
  }

  return Response.json({ recordId: result.recordId }, { status: 201 });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
