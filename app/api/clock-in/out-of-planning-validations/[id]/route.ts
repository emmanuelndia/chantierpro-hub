import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { parseJsonBody } from '@/lib/clock-in';
import {
  canManageOutOfPlanningValidations,
  decideOutOfPlanningValidation,
  parseOutOfPlanningValidationAction,
} from '@/lib/out-of-planning-validations';

export const PATCH = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canManageOutOfPlanningValidations(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces refuse aux validations hors planning.' }, { status: 403 });
  }

  const body = await parseJsonBody<unknown>(req);
  const input = parseOutOfPlanningValidationAction(body);

  if (!input) {
    return Response.json({ code: 'BAD_REQUEST', message: 'Decision invalide.' }, { status: 400 });
  }

  const result = await decideOutOfPlanningValidation(prisma, {
    recordId: params.id,
    user,
    action: input.action,
    note: input.note,
  });

  if (result.code === 'NOT_FOUND') {
    return Response.json({ code: 'NOT_FOUND', message: 'Pointage hors planning introuvable.' }, { status: 404 });
  }

  if (result.code === 'FORBIDDEN') {
    return Response.json({ code: 'FORBIDDEN', message: 'Ce pointage ne depend pas de vos projets.' }, { status: 403 });
  }

  if (result.code === 'ALREADY_DECIDED') {
    return Response.json({ code: 'ALREADY_DECIDED', message: 'Ce pointage a deja ete traite.', item: result.item }, { status: 409 });
  }

  return Response.json({ item: result.item });
}, [Role.PROJECT_MANAGER, Role.DIRECTION, Role.ADMIN]);