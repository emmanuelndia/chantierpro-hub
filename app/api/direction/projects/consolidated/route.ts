import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canAccessDirection,
  getDirectionProjectsConsolidated,
  jsonDirectionError,
  parseDirectionConsolidatedQuery,
} from '@/lib/direction';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessDirection(user.role)) {
    return jsonDirectionError('FORBIDDEN', 403, 'Acces refuse a la consolidation Direction.');
  }

  const query = parseDirectionConsolidatedQuery(new URL(req.url).searchParams);

  if (!query) {
    return jsonDirectionError('BAD_REQUEST', 400, 'Les filtres de consolidation Direction sont invalides.');
  }

  const response = await getDirectionProjectsConsolidated(prisma, query);
  return Response.json(response);
});
