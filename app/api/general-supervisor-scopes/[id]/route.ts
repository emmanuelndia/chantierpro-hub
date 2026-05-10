import { withAuth } from '@/lib/auth/with-auth';
import {
  canManageGeneralSupervisorScopes,
  deactivateGeneralSupervisorScope,
  jsonScopeError,
  updateGeneralSupervisorScope,
} from '@/lib/general-supervisor-scopes';
import { prisma } from '@/lib/prisma';

export const PATCH = withAuth<{ id: string }>(async ({ req, user, params }) => {
  if (!canManageGeneralSupervisorScopes(user.role)) {
    return jsonScopeError('FORBIDDEN', 'Acces refuse a la gestion des perimetres.', 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonScopeError('INVALID_JSON', 'Payload JSON invalide.', 400);
  }

  const result = await updateGeneralSupervisorScope(prisma, user, params.id, body);
  return result instanceof Response ? result : Response.json(result);
});

export const DELETE = withAuth<{ id: string }>(async ({ user, params }) => {
  if (!canManageGeneralSupervisorScopes(user.role)) {
    return jsonScopeError('FORBIDDEN', 'Acces refuse a la gestion des perimetres.', 403);
  }

  return deactivateGeneralSupervisorScope(prisma, user, params.id);
});
