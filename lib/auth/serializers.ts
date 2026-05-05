import type { User } from '@prisma/client';
import type { AuthUser } from '@/types/auth';

export const authUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
} as const;

type SerializableAuthUser = Pick<
  User,
  'id' | 'email' | 'firstName' | 'lastName' | 'role' | 'isActive' | 'mustChangePassword'
>;

export function serializeAuthUser(user: SerializableAuthUser): AuthUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
  };
}
