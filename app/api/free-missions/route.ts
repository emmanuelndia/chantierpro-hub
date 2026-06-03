import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canReadFreeMissions, createFreeMission, listFreeMissions } from '@/lib/free-missions';

export const GET = withAuth(async ({ req, user }) => {
  if (!canReadFreeMissions(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces refuse aux missions libres.' }, { status: 403 });
  }

  const date = new URL(req.url).searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  return Response.json(await listFreeMissions(prisma, user, date));
});

export const POST = withAuth(async ({ req, user }) => {
  const body: unknown = await req.json().catch(() => null);
  return createFreeMission(prisma, user, body);
});
