import type { User } from '@prisma/client';
import type { AuthUser } from '@/types/auth';

export const authUserSelect = {
  id: true,
  username: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
} as const;

type SerializableAuthUser = Pick<
  User,
  'id' | 'username' | 'email' | 'firstName' | 'lastName' | 'role' | 'isActive' | 'mustChangePassword'
>;

export function serializeAuthUser(user: SerializableAuthUser): AuthUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
  };
}
