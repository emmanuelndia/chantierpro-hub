import { Prisma, Role, UserNotificationAudience, type PrismaClient } from '@prisma/client';
import type { CreateUserNotificationRequest, UserNotificationItem } from '@/types/notifications';

type AuthLikeUser = {
  id: string;
  role: Role;
};

const notificationSelect = {
  id: true,
  notificationId: true,
  readAt: true,
  createdAt: true,
  notification: {
    select: {
      title: true,
      message: true,
      audience: true,
      targetRole: true,
      createdAt: true,
      createdBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
        },
      },
    },
  },
} satisfies Prisma.UserNotificationRecipientSelect;

type NotificationRecipientRow = Prisma.UserNotificationRecipientGetPayload<{
  select: typeof notificationSelect;
}>;

export function parseCreateUserNotificationInput(body: unknown): CreateUserNotificationRequest | null {
  if (!isRecord(body)) return null;

  const title = sanitizeText(body.title, 120);
  const message = sanitizeText(body.message, 500);
  const audience = parseAudience(body.audience);
  const targetRole = body.targetRole === undefined || body.targetRole === null ? null : parseRole(body.targetRole);
  const userIds = Array.isArray(body.userIds)
    ? body.userIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  if (!title || !message || !audience) return null;
  if (audience === UserNotificationAudience.ROLE && !targetRole) return null;
  if (audience === UserNotificationAudience.USERS && userIds.length === 0) return null;

  return {
    title,
    message,
    audience,
    targetRole,
    userIds,
  };
}

export async function listUserNotifications(prisma: PrismaClient, user: AuthLikeUser) {
  const items = await prisma.userNotificationRecipient.findMany({
    where: { userId: user.id },
    orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: 20,
    select: notificationSelect,
  });

  return {
    items: items.map(serializeNotification),
    unreadCount: items.filter((item) => !item.readAt).length,
  };
}

export async function createUserNotification(
  prisma: PrismaClient,
  user: AuthLikeUser,
  input: CreateUserNotificationRequest,
) {
  const recipientWhere: Prisma.UserWhereInput =
    input.audience === UserNotificationAudience.ALL
      ? { isActive: true }
      : input.audience === UserNotificationAudience.ROLE && input.targetRole
        ? { isActive: true, role: input.targetRole }
        : { isActive: true, id: { in: input.userIds ?? [] } };

  const recipients = await prisma.user.findMany({
    where: recipientWhere,
    select: { id: true },
  });

  const targetRole = input.audience === UserNotificationAudience.ROLE ? input.targetRole ?? null : null;
  const notification = await prisma.userNotification.create({
    data: {
      title: input.title,
      message: input.message,
      audience: input.audience,
      targetRole,
      createdById: user.id,
      recipients: {
        createMany: {
          data: recipients.map((recipient) => ({ userId: recipient.id })),
          skipDuplicates: true,
        },
      },
    },
    select: { id: true },
  });

  return {
    id: notification.id,
    recipientCount: recipients.length,
  };
}

export async function markNotificationRead(prisma: PrismaClient, user: AuthLikeUser, recipientId: string) {
  const updated = await prisma.userNotificationRecipient.updateMany({
    where: {
      id: recipientId,
      userId: user.id,
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });

  return updated.count > 0;
}

function serializeNotification(row: NotificationRecipientRow): UserNotificationItem {
  return {
    id: row.id,
    notificationId: row.notificationId,
    title: row.notification.title,
    message: row.notification.message,
    audience: row.notification.audience,
    targetRole: row.notification.targetRole,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.notification.createdAt.toISOString(),
    createdBy: row.notification.createdBy,
  };
}

function parseAudience(value: unknown) {
  return typeof value === 'string' && Object.values(UserNotificationAudience).includes(value as UserNotificationAudience)
    ? (value as UserNotificationAudience)
    : null;
}

function parseRole(value: unknown) {
  return typeof value === 'string' && Object.values(Role).includes(value as Role) ? (value as Role) : null;
}

function sanitizeText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
