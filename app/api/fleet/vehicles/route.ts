import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { parseJsonBody } from '@/lib/users';
import {
  canManageFleetVehicles,
  createFleetVehicle,
  listFleetVehicles,
  parseFleetVehiclePayload,
} from '@/lib/fleet-vehicles';

const fleetManagerRoles = [Role.ADMIN, Role.FLEET_MANAGER];

export const GET = withAuth(async ({ user }) => {
  if (!canManageFleetVehicles(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Acces parc auto refuse.' }, { status: 403 });
  }

  return Response.json(await listFleetVehicles(prisma));
}, fleetManagerRoles);

export const POST = withAuth(async ({ req, user }) => {
  if (!canManageFleetVehicles(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Creation vehicule refusee.' }, { status: 403 });
  }

  const body = await parseJsonBody<unknown>(req);
  const input = parseFleetVehiclePayload(body);

  if (!input) {
    return Response.json({ code: 'BAD_REQUEST', message: 'Les donnees du vehicule sont invalides.' }, { status: 400 });
  }

  try {
    const item = await createFleetVehicle(prisma, input);
    return Response.json({ item }, { status: 201 });
  } catch (error) {
    return Response.json(
      { code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'Creation vehicule impossible.' },
      { status: 400 },
    );
  }
}, fleetManagerRoles);
