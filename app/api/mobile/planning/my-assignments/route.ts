import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getSupervisorMyAssignments } from '@/lib/mobile-planning';

export const GET = withAuth(async ({ req, user }) => {
  if (user.role !== Role.SUPERVISOR) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const searchParams = new URL(req.url).searchParams;
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

  try {
    const result = await getSupervisorMyAssignments(prisma, user, date);
    return result instanceof Response ? result : Response.json(result);
  } catch (error) {
    console.error('Mobile supervisor planning assignments error:', error);
    return Response.json(
      { code: 'INTERNAL_ERROR', message: 'Erreur lors du chargement des tâches assignées.' },
      { status: 500 },
    );
  }
});
