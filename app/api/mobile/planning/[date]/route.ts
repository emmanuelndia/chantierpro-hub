import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessMobilePlanning, getPlanningDay } from '@/lib/mobile-planning';

export const GET = withAuth<{ date: string }>(async ({ user, params }) => {
  if (!canAccessMobilePlanning(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  try {
    const result = await getPlanningDay(prisma, user, params.date);
    return result instanceof Response ? result : Response.json(result);
  } catch (error) {
    console.error('Mobile planning day error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement du planning.' },
      { status: 500 },
    );
  }
});
