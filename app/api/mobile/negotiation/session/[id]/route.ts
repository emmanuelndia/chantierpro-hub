import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { closeNegotiationSession } from '@/lib/negotiation';

export const PATCH = withAuth<{ id: string }>(async ({ req, user, params }) => {
  const body: unknown = await req.json().catch(() => null);
  return closeNegotiationSession(prisma, user, params.id, body);
});
