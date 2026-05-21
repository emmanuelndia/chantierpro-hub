import { Role } from '@prisma/client';

export const CLASSIC_FIELD_USER_ROLES: readonly Role[] = [
  Role.SUPERVISOR,
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
];

export const BE_FIELD_USER_ROLES: readonly Role[] = [Role.BE_RESOURCE];

export const FIELD_USER_ROLES: readonly Role[] = [
  ...CLASSIC_FIELD_USER_ROLES,
  ...BE_FIELD_USER_ROLES,
];

export const BE_MANAGER_ROLES: readonly Role[] = [Role.BE_MANAGER];

export function isFieldUserRole(role: Role) {
  return FIELD_USER_ROLES.includes(role);
}

export function isBeManagerRole(role: Role) {
  return BE_MANAGER_ROLES.includes(role);
}
