import type { Role } from '@prisma/client';

export type UserListItem = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  contact: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

export type UserDetail = UserListItem;

export type CreateUserResponse = {
  user: UserDetail;
  temporaryPassword: string;
};

export type PaginatedUsersResponse = {
  items: UserListItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type UserApiErrorCode =
  | 'BAD_REQUEST'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'EMAIL_IMMUTABLE'
  | 'INVALID_ROLE'
  | 'INVALID_PASSWORD'
  | 'INVALID_CURRENT_PASSWORD'
  | 'SELF_DEACTIVATION_FORBIDDEN';
