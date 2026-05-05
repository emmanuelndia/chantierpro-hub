import { Prisma, ProjectStatus, SiteStatus } from '@prisma/client';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessMobileSitesManagement } from '@/lib/mobile-sites';
import { prisma } from '@/lib/prisma';
import {
  assertCreateSiteRadiusAllowed,
  getScopedProjectById,
  jsonProjectError,
  parseCreateSiteInput,
  parseJsonBody,
  serializeSite,
  sitePublicSelect,
  validateDateRange,
  validateRadius,
  validateSiteManager,
} from '@/lib/projects';

export const POST = withAuth(async ({ req, user }) => {
  if (!canAccessMobileSitesManagement(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Accès refusé à la création de chantier.');
  }

  const body = await parseJsonBody<unknown>(req);
  const projectId = getStringField(body, 'projectId');

  if (!projectId) {
    return jsonProjectError('BAD_REQUEST', 400, 'Le projet du chantier est requis.');
  }

  const project = await getScopedProjectById(prisma, projectId, user);

  if (!project) {
    return jsonProjectError('NOT_FOUND', 404, 'Projet introuvable.');
  }

  if (project.status === ProjectStatus.ARCHIVED || project.status === ProjectStatus.COMPLETED) {
    return jsonProjectError(
      'PROJECT_CLOSED',
      400,
      "Impossible d'ajouter un chantier à un projet archivé ou terminé.",
    );
  }

  const input = parseCreateSiteInput(body);

  if (!input) {
    return jsonProjectError('BAD_REQUEST', 400, 'Le payload chantier est invalide.');
  }

  const geofencingError = assertCreateSiteRadiusAllowed(user, input);

  if (geofencingError) {
    return geofencingError;
  }

  if (!validateRadius(input.radiusKm)) {
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
    const site = await prisma.site.create({
      data: {
        projectId: project.id,
        name: input.name,
        address: input.address,
        latitude: new Prisma.Decimal(input.latitude),
        longitude: new Prisma.Decimal(input.longitude),
        radiusKm: new Prisma.Decimal(input.radiusKm),
        description: input.description,
        status: input.status ?? SiteStatus.ACTIVE,
        area: new Prisma.Decimal(input.area),
        startDate: new Date(input.startDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
        siteManagerId: input.siteManagerId,
        createdById: user.id,
      },
      select: sitePublicSelect,
    });

    return Response.json({ site: serializeSite(site) }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return jsonProjectError('INVALID_SITE_MANAGER', 400, 'Responsable de chantier invalide.');
    }

    throw error;
  }
});

function getStringField(body: unknown, key: string) {
  if (typeof body !== 'object' || body === null || !(key in body)) {
    return null;
  }

  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
