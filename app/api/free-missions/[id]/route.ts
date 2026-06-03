import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { deleteFreeMission, updateFreeMission } from '@/lib/free-missions';

export const PATCH = withAuth<{ id: string }>(async ({ req, params, user }) => {
  const body: unknown = await req.json().catch(() => null);
  return updateFreeMission(prisma, user, params.id, body);
});

export const DELETE = withAuth<{ id: string }>(async ({ params, user }) => {
  return deleteFreeMission(prisma, user, params.id);
});
