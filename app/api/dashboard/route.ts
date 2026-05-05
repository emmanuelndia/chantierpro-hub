import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessDashboard, getDashboardData, jsonDashboardError } from '@/lib/dashboard';

export const GET = withAuth(async ({ user }) => {
  if (!canAccessDashboard(user.role)) {
    return jsonDashboardError('FORBIDDEN', 403, 'Acces refuse au dashboard web.');
  }

  const payload = await getDashboardData(prisma, user);
  return Response.json(payload);
});
