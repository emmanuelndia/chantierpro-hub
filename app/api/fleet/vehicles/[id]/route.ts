import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { parseJsonBody } from '@/lib/users';
import {
  canManageFleetVehicles,
  parseFleetVehiclePayload,
  updateFleetVehicle,
} from '@/lib/fleet-vehicles';

const fleetManagerRoles = [Role.ADMIN, Role.FLEET_MANAGER];

export const PATCH = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canManageFleetVehicles(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Modification vehicule refusee.' }, { status: 403 });
  }

  const body = await parseJsonBody<unknown>(req);
  const input = parseFleetVehiclePayload(body);

  if (!input) {
    return Response.json({ code: 'BAD_REQUEST', message: 'Les donnees du vehicule sont invalides.' }, { status: 400 });
  }

  try {
    const item = await updateFleetVehicle(prisma, params.id, input);
    return Response.json({ item });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Modification vehicule impossible.';
    const status = message === 'Vehicule introuvable.' ? 404 : 400;
    return Response.json({ code: status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST', message }, { status });
  }
}, fleetManagerRoles);
