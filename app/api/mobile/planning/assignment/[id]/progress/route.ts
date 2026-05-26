import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canAccessSupervisorPlanning,
  createTaskProgressUpdate,
  getTaskProgressUpdates,
} from '@/lib/mobile-planning';
import type { CreateTaskProgressUpdateRequest } from '@/types/mobile-planning';

export const GET = withAuth<{ id: string }>(async ({ user, params }) => {
  if (!canAccessSupervisorPlanning(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  try {
    const result = await getTaskProgressUpdates(prisma, user, params.id);
    return result instanceof Response ? result : Response.json(result);
  } catch (error) {
    console.error('Mobile planning progress list error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: "Erreur lors du chargement de l'avancement." },
      { status: 500 },
    );
  }
});

export const POST = withAuth<{ id: string }>(async ({ req, user, params }) => {
  if (!canAccessSupervisorPlanning(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  let body: CreateTaskProgressUpdateRequest;
  try {
    body = (await req.json()) as CreateTaskProgressUpdateRequest;
  } catch {
    return Response.json({ code: 'INVALID_JSON', message: 'Payload JSON invalide.' }, { status: 400 });
  }

  try {
    const result = await createTaskProgressUpdate(prisma, user, params.id, body);
    return result instanceof Response ? result : Response.json(result, { status: 201 });
  } catch (error) {
    console.error('Mobile planning progress create error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: "Erreur lors de l'enregistrement de l'avancement." },
      { status: 500 },
    );
  }
});
