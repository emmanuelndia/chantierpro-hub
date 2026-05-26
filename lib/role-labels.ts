import type { Role } from '@prisma/client';

const ROLE_LABELS: Record<Role, string> = {
  SUPERVISOR: 'Superviseur',
  COORDINATOR: 'Coordinateur',
  GENERAL_SUPERVISOR: 'Superviseur général',
  BE_MANAGER: "Responsable Bureau d'étude",
  BE_RESOURCE: "Ressource Bureau d'étude",
  NEGOTIATION_MANAGER: 'Responsable Négociation',
  NEGOTIATION_RESOURCE: 'Ressource Négociation',
  FLEET_MANAGER: 'Responsable Parc Auto',
  DRIVER: 'Chauffeur',
  PROJECT_MANAGER: 'Chef de projet',
  DIRECTION: 'Direction',
  HR: 'Ressources humaines',
  ADMIN: 'Administrateur',
};

export function formatRoleLabel(role: Role) {
  return ROLE_LABELS[role] ?? role.replaceAll('_', ' ');
}
