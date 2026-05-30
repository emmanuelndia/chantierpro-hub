import { withAuth } from '@/lib/auth/with-auth';
import {
  canManageCoordinatorProjectManagerScopes,
  createCoordinatorProjectManagerScope,
  getCoordinatorProjectManagerScopes,
  jsonCoordinatorScopeError,
} from '@/lib/coordinator-project-manager-scopes';
import { prisma } from '@/lib/prisma';

export const GET = withAuth(async ({ user }) => {
  if (!canManageCoordinatorProjectManagerScopes(user.role)) {
    return jsonCoordinatorScopeError('FORBIDDEN', 'Acces refuse aux coordinateurs projet.', 403);
  }

  const payload = await getCoordinatorProjectManagerScopes(prisma, user);
  return payload instanceof Response ? payload : Response.json(payload);
});

export const POST = withAuth(async ({ req, user }) => {
  if (!canManageCoordinatorProjectManagerScopes(user.role)) {
    return jsonCoordinatorScopeError('FORBIDDEN', 'Acces refuse a la gestion des coordinateurs projet.', 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonCoordinatorScopeError('INVALID_JSON', 'Payload JSON invalide.', 400);
  }

  const result = await createCoordinatorProjectManagerScope(prisma, user, body);
  return result instanceof Response ? result : Response.json(result, { status: 201 });
});
