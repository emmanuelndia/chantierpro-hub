import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getMobileNegotiationDay } from '@/lib/negotiation';

export const GET = withAuth(async ({ req, user }) => {
  const date = new URL(req.url).searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const result = await getMobileNegotiationDay(prisma, user, date);
  return result instanceof Response ? result : Response.json(result);
});
