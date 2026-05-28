import { Role } from '@prisma/client';

export const CLASSIC_FIELD_USER_ROLES: readonly Role[] = [
  Role.SUPERVISOR,
  Role.RESOURCE,
  Role.COORDINATOR,
  Role.GENERAL_SUPERVISOR,
];

export const BE_FIELD_USER_ROLES: readonly Role[] = [Role.BE_RESOURCE];
export const NEGOTIATION_FIELD_USER_ROLES: readonly Role[] = [Role.NEGOTIATION_RESOURCE];
export const FLEET_FIELD_USER_ROLES: readonly Role[] = [Role.DRIVER];

export const FIELD_USER_ROLES: readonly Role[] = [
  ...CLASSIC_FIELD_USER_ROLES,
  ...BE_FIELD_USER_ROLES,
  ...NEGOTIATION_FIELD_USER_ROLES,
  ...FLEET_FIELD_USER_ROLES,
];

type BusinessManagerRole = Extract<Role, 'BE_MANAGER' | 'NEGOTIATION_MANAGER' | 'FLEET_MANAGER'>;

export const BUSINESS_MANAGER_RESOURCE_ROLES: Record<BusinessManagerRole, readonly Role[]> = {
  [Role.BE_MANAGER]: BE_FIELD_USER_ROLES,
  [Role.NEGOTIATION_MANAGER]: NEGOTIATION_FIELD_USER_ROLES,
  [Role.FLEET_MANAGER]: FLEET_FIELD_USER_ROLES,
};

export const BUSINESS_MANAGER_ROLES: readonly BusinessManagerRole[] = [
  Role.BE_MANAGER,
  Role.NEGOTIATION_MANAGER,
  Role.FLEET_MANAGER,
];
export const BUSINESS_FIELD_RESOURCE_ROLES: readonly Role[] = [
  ...BE_FIELD_USER_ROLES,
  ...NEGOTIATION_FIELD_USER_ROLES,
  ...FLEET_FIELD_USER_ROLES,
];

export const BE_MANAGER_ROLES: readonly Role[] = [Role.BE_MANAGER];

export function isFieldUserRole(role: Role) {
  return FIELD_USER_ROLES.includes(role);
}

export function isBeManagerRole(role: Role) {
  return BE_MANAGER_ROLES.includes(role);
}

export function isBusinessManagerRole(role: Role): role is BusinessManagerRole {
  return BUSINESS_MANAGER_ROLES.includes(role as BusinessManagerRole);
}

export function getBusinessManagedResourceRoles(role: Role): readonly Role[] {
  return isBusinessManagerRole(role) ? BUSINESS_MANAGER_RESOURCE_ROLES[role] : [];
}
