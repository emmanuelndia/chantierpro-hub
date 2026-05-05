import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessMobileProjects, getMobileProjectDetail } from '@/lib/mobile-projects';
import {
  getScopedProjectById,
  jsonProjectError,
  parseJsonBody,
  parseUpdateProjectInput,
  projectDetailSelect,
  serializeProjectDetail,
  validateDateRange,
  validateProjectManager,
} from '@/lib/projects';

export const GET = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canAccessMobileProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Accès refusé au détail projet mobile.');
  }

  const detail = await getMobileProjectDetail(prisma, user, params.id);

  if (!detail) {
    return jsonProjectError('NOT_FOUND', 404, 'Projet introuvable.');
  }

  return Response.json(detail);
});

export const PATCH = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canAccessMobileProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Accès refusé à la modification de projet.');
  }

  const existingProject = await getScopedProjectById(prisma, params.id, user);

  if (!existingProject) {
    return jsonProjectError('NOT_FOUND', 404, 'Projet introuvable.');
  }

  const body = await parseJsonBody<unknown>(req);
  const input = parseUpdateProjectInput(body);

  if (!input) {
    return jsonProjectError('BAD_REQUEST', 400, 'Le payload projet est invalide.');
  }

  if (!validateDateRange(input.startDate, input.endDate)) {
    return jsonProjectError(
      'INVALID_DATE_RANGE',
      400,
      'La date de fin doit être strictement supérieure à la date de début.',
    );
  }

  const projectManagerIsValid = await validateProjectManager(prisma, input.projectManagerId, user);

  if (!projectManagerIsValid) {
    return jsonProjectError(
      'INVALID_PROJECT_MANAGER',
      400,
      'Le chef de projet sélectionné est invalide pour cette opération.',
    );
  }

  try {
    const project = await prisma.project.update({
      where: { id: params.id },
      data: {
        name: input.name,
        description: input.description,
        address: input.address,
        city: input.city,
        startDate: new Date(input.startDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
        projectManagerId: input.projectManagerId,
        status: input.status,
      },
      select: projectDetailSelect,
    });

    return Response.json({ project: serializeProjectDetail(project) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return jsonProjectError('INVALID_PROJECT_MANAGER', 400, 'Chef de projet invalide.');
    }

    throw error;
  }
});
