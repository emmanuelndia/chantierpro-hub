import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessWebPlanning, getPlanningDay } from '@/lib/mobile-planning';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessWebPlanning(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const date = new URL(req.url).searchParams.get('date');

  if (!date) {
    return Response.json({ code: 'INVALID_DATE', message: 'Date requise.' }, { status: 400 });
  }

  try {
    const result = await getPlanningDay(prisma, user, date);
    return result instanceof Response ? result : Response.json(result);
  } catch (error) {
    console.error('Web planning day error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement du planning.' },
      { status: 500 },
    );
  }
});
