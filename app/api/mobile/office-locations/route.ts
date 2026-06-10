import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canUseOfficeClockIn, listOfficeLocations } from '@/lib/office-locations';

export const GET = withAuth(async ({ user }) => {
  if (!canUseOfficeClockIn(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces refuse aux bureaux.' }, { status: 403 });
  }

  return Response.json(await listOfficeLocations(prisma, true));
});
