import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  assertUpdateSiteRadiusAllowed,
  canReadProjects,
  canWriteProjects,
  getScopedSiteById,
  jsonProjectError,
  parseJsonBody,
  parseUpdateSiteInput,
  serializeSite,
  sitePublicSelect,
  validateDateRange,
  validateRadius,
  validateSiteManager,
} from '@/lib/projects';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canReadProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Acces refuse aux chantiers.');
  }

  const site = await getScopedSiteById(prisma, params.id, user);

  if (!site) {
    return jsonProjectError('NOT_FOUND', 404, 'Chantier introuvable.');
  }

  return NextResponse.json({ site: serializeSite(site) });
});

export const PUT = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canWriteProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Acces refuse a la modification de chantier.');
  }

  const existingSite = await getScopedSiteById(prisma, params.id, user);

  if (!existingSite) {
    return jsonProjectError('NOT_FOUND', 404, 'Chantier introuvable.');
  }

  const body = await parseJsonBody<unknown>(req);
  const input = parseUpdateSiteInput(body);

  if (!input) {
    return jsonProjectError('BAD_REQUEST', 400, 'Le payload chantier est invalide.');
  }

  const geofencingError = assertUpdateSiteRadiusAllowed(
    user,
    existingSite.radiusKm.toNumber(),
    input,
  );

  if (geofencingError) {
    return geofencingError;
  }

  const radiusKm = input.radiusKmProvided && input.radiusKm !== undefined ? input.radiusKm : existingSite.radiusKm.toNumber();
  const startDate = input.startDate ?? existingSite.startDate.toISOString();
  const endDate = input.endDate !== undefined ? input.endDate : existingSite.endDate?.toISOString() ?? null;
  const siteManagerId = input.siteManagerId ?? existingSite.siteManagerId;

  if (!validateRadius(radiusKm)) {
    return jsonProjectError('INVALID_RADIUS', 400, 'Le rayon du chantier doit etre compris entre 0.5 et 10 km.');
  }

  if (!validateDateRange(startDate, endDate)) {
    return jsonProjectError(
      'INVALID_DATE_RANGE',
      400,
      'La date de fin doit etre strictement superieure a la date de debut.',
    );
  }

  const siteManagerIsValid = siteManagerId === existingSite.siteManagerId || (await validateSiteManager(prisma, siteManagerId));

  if (!siteManagerIsValid) {
    return jsonProjectError('INVALID_SITE_MANAGER', 400, 'Le responsable de chantier est invalide.');
  }

  try {
    const site = await prisma.site.update({
      where: { id: params.id },
      data: {
        name: input.name ?? existingSite.name,
        address: input.address ?? existingSite.address,
        latitude: new Prisma.Decimal(input.latitude ?? existingSite.latitude.toNumber()),
        longitude: new Prisma.Decimal(input.longitude ?? existingSite.longitude.toNumber()),
        radiusKm: new Prisma.Decimal(radiusKm),
        description: input.description ?? existingSite.description,
        status: input.status ?? existingSite.status,
        area: new Prisma.Decimal(input.area ?? existingSite.area.toNumber()),
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        siteManagerId,
      },
      select: sitePublicSelect,
    });

    return NextResponse.json({ site: serializeSite(site) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return jsonProjectError('INVALID_SITE_MANAGER', 400, 'Responsable de chantier invalide.');
    }

    throw error;
  }
});
