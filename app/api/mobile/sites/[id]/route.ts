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

  const radiusKm = input.radiusKmProvided ? input.radiusKm : existingSite.radiusKm.toNumber();

  if (!validateRadius(radiusKm)) {
    return jsonProjectError('INVALID_RADIUS', 400, 'Le rayon du chantier doit être compris entre 0.5 et 10 km.');
  }

  if (!validateDateRange(input.startDate, input.endDate)) {
    return jsonProjectError(
      'INVALID_DATE_RANGE',
      400,
      'La date de fin doit être strictement supérieure à la date de début.',
    );
  }

  const siteManagerIsValid = await validateSiteManager(prisma, input.siteManagerId);

  if (!siteManagerIsValid) {
    return jsonProjectError('INVALID_SITE_MANAGER', 400, 'Le responsable de chantier est invalide.');
  }

  try {
    const site = await prisma.site.update({
      where: { id: params.id },
      data: {
        name: input.name,
        address: input.address,
        latitude: new Prisma.Decimal(input.latitude),
        longitude: new Prisma.Decimal(input.longitude),
        radiusKm: new Prisma.Decimal(radiusKm),
        description: input.description,
        status: input.status,
        area: new Prisma.Decimal(input.area),
        startDate: new Date(input.startDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
        siteManagerId: input.siteManagerId,
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
