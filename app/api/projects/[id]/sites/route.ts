import { NextResponse } from 'next/server';
import { Prisma, SiteStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import {
  assertCreateSiteRadiusAllowed,
  canWriteProjects,
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

export const POST = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canWriteProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Acces refuse a la creation de chantier.');
  }

  const project = await getScopedProjectById(prisma, params.id, user);

  if (!project) {
    return jsonProjectError('NOT_FOUND', 404, 'Projet introuvable.');
  }

  if (project.status === 'ARCHIVED' || project.status === 'COMPLETED') {
    return jsonProjectError(
      'PROJECT_CLOSED',
      400,
      "Impossible d'ajouter un chantier a un projet archive ou termine.",
    );
  }

  const body = await parseJsonBody<unknown>(req);
  const input = parseCreateSiteInput(body);

  if (!input) {
    return jsonProjectError('BAD_REQUEST', 400, 'Le payload chantier est invalide.');
  }

  const geofencingError = assertCreateSiteRadiusAllowed(user, input);

  if (geofencingError) {
    return geofencingError;
  }

  if (!validateRadius(input.radiusKm)) {
    return jsonProjectError('INVALID_RADIUS', 400, 'Le rayon du chantier doit etre compris entre 0.5 et 10 km.');
  }

  if (!validateDateRange(input.startDate, input.endDate)) {
    return jsonProjectError(
      'INVALID_DATE_RANGE',
      400,
      'La date de fin doit etre strictement superieure a la date de debut.',
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

    return NextResponse.json({ site: serializeSite(site) }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return jsonProjectError('INVALID_SITE_MANAGER', 400, 'Responsable de chantier invalide.');
    }

    throw error;
  }
});
