import type { Role, UserNotificationAudience } from '@prisma/client';

export type UserNotificationItem = {
  id: string;
  notificationId: string;
  title: string;
  message: string;
  audience: UserNotificationAudience;
  targetRole: Role | null;
  readAt: string | null;
  createdAt: string;
  createdBy: {
    id: string;
    firstName: string;
    lastName: string;
    role: Role;
  };
};

export type UserNotificationsResponse = {
  items: UserNotificationItem[];
  unreadCount: number;
};

export type CreateUserNotificationRequest = {
  title: string;
  message: string;
  audience: UserNotificationAudience;
  targetRole?: Role | null;
  targetRoles?: Role[];
  userIds?: string[];
};
