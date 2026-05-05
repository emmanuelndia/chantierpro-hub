import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessDirection, getDirectionActiveSites, jsonDirectionError } from '@/lib/direction';

export const GET = withAuth(async ({ user }) => {
  if (!canAccessDirection(user.role)) {
    return jsonDirectionError('FORBIDDEN', 403, 'Acces refuse a la carte Direction.');
  }

  const response = await getDirectionActiveSites(prisma);
  return Response.json(response);
});
