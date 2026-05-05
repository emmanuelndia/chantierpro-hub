import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canAccessMobileSiteSupervision,
  getMobileSiteSupervision,
} from '@/lib/mobile-site-supervision';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canAccessMobileSiteSupervision(user.role)) {
    return Response.json({ code: 'FORBIDDEN' }, { status: 403 });
  }

  const response = await getMobileSiteSupervision(prisma, user, params.id);

  if (!response) {
    return Response.json({ code: 'NOT_FOUND' }, { status: 404 });
  }

  return Response.json(response);
});
