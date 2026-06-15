import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessNegotiation, listNegotiationZones } from '@/lib/negotiation';

export const GET = withAuth(async ({ req, user }) => {
  if (!canAccessNegotiation(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces zones negociation refuse.' }, { status: 403 });
  }

  const projectId = new URL(req.url).searchParams.get('projectId') ?? undefined;
  const zones = await listNegotiationZones(prisma, user, projectId);

  return Response.json({ zones });
});
