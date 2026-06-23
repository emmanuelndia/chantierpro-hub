import type { Role } from '@prisma/client';

const ROLE_LABELS: Record<Role, string> = {
  SUPERVISOR: 'Superviseur',
  RESOURCE: 'Ressource',
  EXTERNAL_RESOURCE: 'Ressource externe',
  COORDINATOR: 'Coordinateur',
  GENERAL_SUPERVISOR: 'Superviseur général',
  BE_MANAGER: "Responsable Bureau d'étude",
  BE_RESOURCE: "Ressource Bureau d'étude",
  NEGOTIATION_MANAGER: 'Responsable Négociation',
  NEGOTIATION_RESOURCE: 'Ressource Négociation',
  FLEET_MANAGER: 'Responsable Parc Auto',
  FLEET_RESOURCE: 'Ressource parc auto',
  PROJECT_MANAGER: 'Chef de projet',
  DIRECTION: 'Direction',
  HR: 'Ressources humaines',
  ADMIN: 'Administrateur',
  AUDITOR: 'Auditeur',
  OFFICE_STAFF: 'Personnel bureau',
};

export function formatRoleLabel(role: Role) {
  return ROLE_LABELS[role] ?? role.replaceAll('_', ' ');
}
