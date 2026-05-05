import type { Role } from '@prisma/client';

export type AuthRole = Role;

export type AuthUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: AuthRole;
  isActive: boolean;
  mustChangePassword: boolean;
};

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'TOO_MANY_ATTEMPTS';

export type LoginResponse = {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
};

export type RefreshResponse = {
  accessToken: string;
  expiresIn: number;
};
