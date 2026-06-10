import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { createNegotiationVisit } from '@/lib/negotiation';

export const POST = withAuth(async ({ req, user }) => {
  const body: unknown = await req.json().catch(() => null);
  return createNegotiationVisit(prisma, user, body);
});
