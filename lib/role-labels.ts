import type { Role } from '@prisma/client';

const ROLE_LABELS: Record<Role, string> = {
  SUPERVISOR: 'Chef de chantier',
  COORDINATOR: 'Coordinateur',
  GENERAL_SUPERVISOR: 'Superviseur general',
  BE_MANAGER: "Responsable Bureau d'etude",
  BE_RESOURCE: "Ressource Bureau d'etude",
  PROJECT_MANAGER: 'Chef de projet',
  DIRECTION: 'Direction',
  HR: 'Ressources humaines',
  ADMIN: 'Administrateur',
};

export function formatRoleLabel(role: Role) {
  return ROLE_LABELS[role] ?? role.replaceAll('_', ' ');
}
