import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessDirection, getDirectionAlerts, jsonDirectionError } from '@/lib/direction';

export const GET = withAuth(async ({ user }) => {
  if (!canAccessDirection(user.role)) {
    return jsonDirectionError('FORBIDDEN', 403, 'Acces refuse aux alertes Direction.');
  }

  const response = await getDirectionAlerts(prisma);
  return Response.json(response);
});
