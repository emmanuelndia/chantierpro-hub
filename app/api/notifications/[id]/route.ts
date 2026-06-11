import { prisma } from '@/lib/prisma';
import { deleteUserNotificationRecipient } from '@/lib/notifications';
import { withAuth } from '@/lib/auth/with-auth';

export const DELETE = withAuth<{ id: string }>(async ({ params, user }) => {
  const deleted = await deleteUserNotificationRecipient(prisma, user, params.id);

  if (!deleted) {
    return Response.json({ code: 'NOT_FOUND', message: 'Notification introuvable.' }, { status: 404 });
  }

  return new Response(null, { status: 204 });
});
