import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { jsonRhError, regularizeRhSession } from '@/lib/rh';

export const POST = withAuth(async ({ req, user }) => {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return jsonRhError('BAD_REQUEST', 400, 'Le payload de regularisation est invalide.');
  }

  if (!isRecord(body)) {
    return jsonRhError('BAD_REQUEST', 400, 'Le payload de regularisation est invalide.');
  }

  const arrivalRecordId = typeof body.arrivalRecordId === 'string' ? body.arrivalRecordId : '';
  const departureRecordId =
    typeof body.departureRecordId === 'string' && body.departureRecordId.trim()
      ? body.departureRecordId
      : null;
  const correctedDepartureTime =
    typeof body.correctedDepartureTime === 'string' ? body.correctedDepartureTime : '';
  const comment = typeof body.comment === 'string' ? body.comment : '';

  const result = await regularizeRhSession(prisma, {
    arrivalRecordId,
    departureRecordId,
    correctedDepartureTime,
    comment,
    author: user,
  });

  if (result.code === 'FORBIDDEN') {
    return jsonRhError('FORBIDDEN', 403, 'Acces refuse a la regularisation RH.');
  }

  if (result.code === 'NOT_FOUND') {
    return jsonRhError('NOT_FOUND', 404, 'Session a regulariser introuvable.');
  }

  if (result.code === 'BAD_REQUEST') {
    return jsonRhError('BAD_REQUEST', 400, 'Les donnees de regularisation sont invalides.');
  }

  return Response.json({ recordId: result.recordId }, { status: 201 });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
