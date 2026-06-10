import { prisma } from '@/lib/prisma';
import { markNotificationRead } from '@/lib/notifications';
import { withAuth } from '@/lib/auth/with-auth';

export const PATCH = withAuth<{ id: string }>(async ({ params, user }) => {
  const updated = await markNotificationRead(prisma, user, params.id);

  if (!updated) {
    return Response.json({ code: 'NOT_FOUND', message: 'Notification introuvable.' }, { status: 404 });
  }

  return new Response(null, { status: 204 });
});
