import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  canManageFleetVehicles,
  commitFleetVehicleImport,
  parseFleetVehicleWorkbook,
} from '@/lib/fleet-vehicles';

const fleetManagerRoles = [Role.ADMIN, Role.FLEET_MANAGER];

export const POST = withAuth(async ({ req, user }) => {
  if (!canManageFleetVehicles(user.role)) {
    return Response.json({ code: 'FORBIDDEN', message: 'Import parc auto refuse.' }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return Response.json({ code: 'BAD_REQUEST', message: 'Fichier Excel obligatoire.' }, { status: 400 });
  }

  try {
    const rows = await parseFleetVehicleWorkbook(file, prisma);
    if (rows.some((row) => !row.valid)) {
      return Response.json(
        { code: 'BAD_REQUEST', message: 'Le fichier contient des lignes invalides. Corrige la previsualisation avant import.' },
        { status: 400 },
      );
    }

    return Response.json(await commitFleetVehicleImport(prisma, rows));
  } catch (error) {
    return Response.json(
      { code: 'BAD_REQUEST', message: error instanceof Error ? error.message : 'Import impossible.' },
      { status: 400 },
    );
  }
}, fleetManagerRoles);
