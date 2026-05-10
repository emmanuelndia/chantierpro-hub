import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canMutateWebPlanning, deletePlanningAssignment, updatePlanningAssignment } from '@/lib/mobile-planning';
import type { PlanningWebUpdateRequest } from '@/types/planning-web';

export const PATCH = withAuth<{ id: string }>(async ({ req, user, params }) => {
  if (!canMutateWebPlanning(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces refuse aux modifications du planning.' }, { status: 403 });
  }

  let body: PlanningWebUpdateRequest;
  try {
    body = (await req.json()) as PlanningWebUpdateRequest;
  } catch {
    return Response.json({ code: 'INVALID_JSON', message: 'Payload JSON invalide.' }, { status: 400 });
  }

  try {
    const result = await updatePlanningAssignment(prisma, user, params.id, body);
    return result instanceof Response ? result : Response.json(result);
  } catch (error) {
    console.error('Web planning update assignment error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: "Erreur lors de la mise a jour de l'assignation." },
      { status: 500 },
    );
  }
});

export const DELETE = withAuth<{ id: string }>(async ({ user, params }) => {
  if (!canMutateWebPlanning(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces refuse aux modifications du planning.' }, { status: 403 });
  }

  try {
    return await deletePlanningAssignment(prisma, user, params.id);
  } catch (error) {
    console.error('Web planning delete assignment error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: "Erreur lors du retrait de l'assignation." },
      { status: 500 },
    );
  }
});
