import { withAuth } from '@/lib/auth/with-auth';
import {
  canManageGeneralSupervisorScopes,
  createGeneralSupervisorScope,
  getGeneralSupervisorScopes,
  jsonScopeError,
} from '@/lib/general-supervisor-scopes';
import { prisma } from '@/lib/prisma';

export const GET = withAuth(async ({ user }) => {
  if (!canManageGeneralSupervisorScopes(user.role)) {
    return jsonScopeError('FORBIDDEN', 'Acces refuse a la gestion des perimetres.', 403);
  }

  const payload = await getGeneralSupervisorScopes(prisma, user);
  return payload instanceof Response ? payload : Response.json(payload);
});

export const POST = withAuth(async ({ req, user }) => {
  if (!canManageGeneralSupervisorScopes(user.role)) {
    return jsonScopeError('FORBIDDEN', 'Acces refuse a la gestion des perimetres.', 403);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonScopeError('INVALID_JSON', 'Payload JSON invalide.', 400);
  }

  const result = await createGeneralSupervisorScope(prisma, user, body);
  return result instanceof Response ? result : Response.json(result, { status: 201 });
});
