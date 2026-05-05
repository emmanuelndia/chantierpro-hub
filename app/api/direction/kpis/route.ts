import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canAccessDirection,
  getDirectionKpis,
  jsonDirectionError,
  parseDirectionPeriodQuery,
} from '@/lib/direction';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessDirection(user.role)) {
    return jsonDirectionError('FORBIDDEN', 403, 'Acces refuse aux indicateurs Direction.');
  }

  const query = parseDirectionPeriodQuery(new URL(req.url).searchParams);

  if (!query) {
    return jsonDirectionError('BAD_REQUEST', 400, 'Les parametres month et year sont invalides.');
  }

  const response = await getDirectionKpis(prisma, query);
  return Response.json(response);
});
