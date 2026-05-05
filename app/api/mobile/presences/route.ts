import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canAccessMobileManagementPresences,
  getMobileManagementPresences,
} from '@/lib/mobile-management-presences';

const statusValues = new Set(['present', 'paused', 'alerts']);

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessMobileManagementPresences(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const searchParams = new URL(req.url).searchParams;
  const rawStatus = searchParams.get('status');
  const status = rawStatus && statusValues.has(rawStatus) ? rawStatus : null;

  return Response.json(
    await getMobileManagementPresences(prisma, user, {
      projectId: searchParams.get('projectId'),
      status: status as 'present' | 'paused' | 'alerts' | null,
      q: searchParams.get('q'),
    }),
  );
});
