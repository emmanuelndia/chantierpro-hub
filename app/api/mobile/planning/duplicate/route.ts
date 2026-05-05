import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessMobilePlanning, duplicatePlanningAssignments } from '@/lib/mobile-planning';
import type { DuplicateAssignmentsRequest } from '@/types/mobile-planning';

export const POST = withAuth(async ({ req, user }) => {
  if (!canAccessMobilePlanning(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  let body: DuplicateAssignmentsRequest;
  try {
    body = (await req.json()) as DuplicateAssignmentsRequest;
  } catch {
    return Response.json({ code: 'INVALID_JSON', message: 'Payload JSON invalide.' }, { status: 400 });
  }

  try {
    const result = await duplicatePlanningAssignments(prisma, user, body.sourceDate, body.targetDate);
    return result instanceof Response ? result : Response.json(result, { status: 201 });
  } catch (error) {
    console.error('Mobile planning duplicate assignments error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors de la duplication des assignations.' },
      { status: 500 },
    );
  }
});
