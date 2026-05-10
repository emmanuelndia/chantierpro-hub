import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canMutateWebPlanning, createPlanningAssignment } from '@/lib/mobile-planning';
import type { PlanningWebCreateRequest } from '@/types/planning-web';

export const POST = withAuth(async ({ req, user }) => {
  if (!canMutateWebPlanning(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces refuse aux modifications du planning.' }, { status: 403 });
  }

  let body: PlanningWebCreateRequest;
  try {
    body = (await req.json()) as PlanningWebCreateRequest;
  } catch {
    return Response.json({ code: 'INVALID_JSON', message: 'Payload JSON invalide.' }, { status: 400 });
  }

  try {
    const result = await createPlanningAssignment(prisma, user, body);
    return result instanceof Response ? result : Response.json(result, { status: 201 });
  } catch (error) {
    console.error('Web planning create assignment error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: "Erreur lors de la creation de l'assignation." },
      { status: 500 },
    );
  }
});
