import { withAuth } from '@/lib/auth/with-auth';
import {
  canManageCoordinatorProjectManagerScopes,
  deleteCoordinatorProjectManagerScope,
  jsonCoordinatorScopeError,
} from '@/lib/coordinator-project-manager-scopes';
import { prisma } from '@/lib/prisma';

export const DELETE = withAuth<{ id: string }>(async ({ user, params }) => {
  if (!canManageCoordinatorProjectManagerScopes(user.role)) {
    return jsonCoordinatorScopeError('FORBIDDEN', 'Acces refuse a la gestion des coordinateurs projet.', 403);
  }

  return deleteCoordinatorProjectManagerScope(prisma, user, params.id);
});
