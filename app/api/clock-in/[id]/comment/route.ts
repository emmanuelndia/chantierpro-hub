import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  jsonClockInError,
  parseCommentInput,
  parseJsonBody,
  updateClockInComment,
} from '@/lib/clock-in';

export const PATCH = withAuth<{ id: string }>(async ({ params, req, user }) => {
  const body = await parseJsonBody<unknown>(req);
  const input = parseCommentInput(body);

  if (!input) {
    return jsonClockInError('BAD_REQUEST', 400, 'Le commentaire est invalide.');
  }

  const result = await updateClockInComment(prisma, {
    recordId: params.id,
    userId: user.id,
    comment: input.comment,
  });

  if (result.code === 'NOT_FOUND') {
    return jsonClockInError('NOT_FOUND', 404, 'Pointage introuvable.');
  }

  if (result.code === 'FORBIDDEN') {
    return jsonClockInError('PERMISSION_DENIED', 403, 'Commentaire non autorise.');
  }

  return Response.json({ record: result.record });
});
