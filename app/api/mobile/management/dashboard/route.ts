import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canAccessMobileManagementDashboard,
  getMobileManagementDashboard,
} from '@/lib/mobile-management';

export const GET = withAuth(async ({ user }) => {
  if (!canAccessMobileManagementDashboard(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  return Response.json(await getMobileManagementDashboard(prisma, user));
});
