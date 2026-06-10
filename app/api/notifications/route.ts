import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  createUserNotification,
  listUserNotifications,
  parseCreateUserNotificationInput,
} from '@/lib/notifications';
import { parseJsonBody } from '@/lib/clock-in';
import { withAuth } from '@/lib/auth/with-auth';

export const GET = withAuth(async ({ user }) => {
  return Response.json(await listUserNotifications(prisma, user));
});

export const POST = withAuth(
  async ({ req, user }) => {
    const body = await parseJsonBody<unknown>(req);
    const input = parseCreateUserNotificationInput(body);

    if (!input) {
      return Response.json({ code: 'BAD_REQUEST', message: 'Notification invalide.' }, { status: 400 });
    }

    const payload = await createUserNotification(prisma, user, input);
    return Response.json(payload, { status: 201 });
  },
  [Role.ADMIN],
);
