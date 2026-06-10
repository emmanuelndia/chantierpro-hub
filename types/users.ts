import type { Role } from '@prisma/client';

export type UserAvailability = {
  status: 'AVAILABLE' | 'ASSIGNED';
  label: string;
  date: string | null;
  assignmentId: string | null;
  siteId: string | null;
  siteName: string | null;
};

export type UserProjectManagerScope = {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
};

export type UserListItem = {
  id: string;
  username: string;
  email: string | null;
  matricule: string | null;
  firstName: string;
  lastName: string;
  role: Role;
  contact: string;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  availability?: UserAvailability;
  projectManagerScopes: UserProjectManagerScope[];
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
