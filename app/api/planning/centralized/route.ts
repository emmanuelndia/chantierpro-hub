import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canAccessCentralizedPlanning,
  getCentralizedPlanning,
  parseCentralizedPlanningFilters,
} from '@/lib/planning-centralized';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessCentralizedPlanning(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces refuse au planning centralise.' }, { status: 403 });
  }

  const filters = parseCentralizedPlanningFilters(req.nextUrl.searchParams);
  if (!filters) {
    return Response.json({ code: 'INVALID_FILTERS', message: 'Filtres planning invalides.' }, { status: 400 });
  }

  try {
    const result = await getCentralizedPlanning(prisma, user, filters);
    return result instanceof Response ? result : Response.json(result);
  } catch (error) {
    console.error('Centralized planning error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement du planning centralise.' },
      { status: 500 },
    );
  }
});
