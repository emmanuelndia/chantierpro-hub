import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canMutateWebPlanning, duplicatePlanningAssignments } from '@/lib/mobile-planning';
import type { PlanningWebDuplicateRequest } from '@/types/planning-web';

export const POST = withAuth(async ({ req, user }) => {
  if (!canMutateWebPlanning(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces refuse aux modifications du planning.' }, { status: 403 });
  }

  let body: PlanningWebDuplicateRequest;
  try {
    body = (await req.json()) as PlanningWebDuplicateRequest;
  } catch {
    return Response.json({ code: 'INVALID_JSON', message: 'Payload JSON invalide.' }, { status: 400 });
  }

  try {
    const result = await duplicatePlanningAssignments(prisma, user, body.sourceDate, body.targetDate, body.assignmentId);
    return result instanceof Response ? result : Response.json(result, { status: 201 });
  } catch (error) {
    console.error('Web planning duplicate assignments error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors de la duplication des assignations.' },
      { status: 500 },
    );
  }
});
