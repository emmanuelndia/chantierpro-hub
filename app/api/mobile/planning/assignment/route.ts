import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessMobilePlanning, createPlanningAssignment } from '@/lib/mobile-planning';
import type { CreateAssignmentRequest } from '@/types/mobile-planning';

export const POST = withAuth(async ({ req, user }) => {
  if (!canAccessMobilePlanning(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  let body: CreateAssignmentRequest;
  try {
    body = (await req.json()) as CreateAssignmentRequest;
  } catch {
    return Response.json({ code: 'INVALID_JSON', message: 'Payload JSON invalide.' }, { status: 400 });
  }

  try {
    const result = await createPlanningAssignment(prisma, user, body);
    return result instanceof Response ? result : Response.json(result, { status: 201 });
  } catch (error) {
    console.error('Mobile planning create assignment error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: "Erreur lors de la création de l'assignation." },
      { status: 500 },
    );
  }
});
