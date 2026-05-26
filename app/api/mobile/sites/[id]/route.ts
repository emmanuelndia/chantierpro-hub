import { Prisma } from '@prisma/client';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessMobileSitesManagement } from '@/lib/mobile-sites';
import { prisma } from '@/lib/prisma';
import {
  assertUpdateSiteRadiusAllowed,
  getScopedSiteById,
  jsonProjectError,
  parseJsonBody,
  parseUpdateSiteInput,
  serializeSite,
  sitePublicSelect,
  validateDateRange,
  validateRadius,
  validateSiteGps,
  validateSiteManager,
} from '@/lib/projects';

export const PATCH = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canAccessMobileSitesManagement(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Accès refusé à la modification de chantier.');
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

  const geofencingError = assertUpdateSiteRadiusAllowed(user, existingSite.radiusKm.toNumber(), input);

  if (geofencingError) {
    return geofencingError;
  }

  const radiusKm = input.radiusKmProvided && input.radiusKm !== undefined ? input.radiusKm : existingSite.radiusKm.toNumber();
  const requiresClockIn = input.requiresClockIn ?? existingSite.requiresClockIn;
  const latitude = input.latitude ?? existingSite.latitude.toNumber();
  const longitude = input.longitude ?? existingSite.longitude.toNumber();
  const startDate = input.startDate ?? existingSite.startDate.toISOString();
  const endDate = input.endDate !== undefined ? input.endDate : existingSite.endDate?.toISOString() ?? null;
  const siteManagerId = input.siteManagerId ?? existingSite.siteManagerId;

  if (!validateRadius(radiusKm)) {
    return jsonProjectError('INVALID_RADIUS', 400, 'Le rayon du chantier doit être compris entre 0.5 et 10 km.');
  }

  if (requiresClockIn && !validateSiteGps(latitude, longitude)) {
    return jsonProjectError('BAD_REQUEST', 400, 'Des coordonnées GPS valides sont requises pour un lieu avec pointage.');
  }

  if (!validateDateRange(startDate, endDate)) {
    return jsonProjectError(
      'INVALID_DATE_RANGE',
      400,
      'La date de fin doit être strictement supérieure à la date de début.',
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
        siteType: input.siteType ?? existingSite.siteType,
        requiresClockIn,
        latitude: new Prisma.Decimal(latitude),
        longitude: new Prisma.Decimal(longitude),
        radiusKm: new Prisma.Decimal(radiusKm),
        geofenceType: input.geofenceType ?? existingSite.geofenceType,
        geofencePolygon:
          input.geofenceType === 'RADIUS'
            ? Prisma.JsonNull
            : input.geofencePolygon !== undefined
              ? input.geofencePolygon ?? Prisma.JsonNull
              : existingSite.geofencePolygon ?? Prisma.JsonNull,
        description: input.description ?? existingSite.description,
        status: input.status ?? existingSite.status,
        area: new Prisma.Decimal(input.area ?? existingSite.area.toNumber()),
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        siteManagerId,
      },
      select: sitePublicSelect,
    });

    return Response.json({ site: serializeSite(site) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return jsonProjectError('INVALID_SITE_MANAGER', 400, 'Responsable de chantier invalide.');
    }

    throw error;
  }
});
