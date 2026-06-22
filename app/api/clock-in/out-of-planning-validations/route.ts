import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canManageOutOfPlanningValidations,
  listOutOfPlanningValidations,
  parseOutOfPlanningValidationStatus,
} from '@/lib/out-of-planning-validations';

export const GET = withAuth(async ({ req, user }) => {
  if (!canManageOutOfPlanningValidations(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces refuse aux validations hors planning.' }, { status: 403 });
  }

  const status = parseOutOfPlanningValidationStatus(new URL(req.url).searchParams.get('status'));
  const payload = await listOutOfPlanningValidations(prisma, user, status);
  return Response.json(payload);
}, [Role.PROJECT_MANAGER, Role.DIRECTION, Role.ADMIN]);