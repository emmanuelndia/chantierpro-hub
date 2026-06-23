import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { canAccessMobileProjects, canMutateMobileProjects, getMobileProjectDetail } from '@/lib/mobile-projects';
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
  if (!canMutateMobileProjects(user.role)) {
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

  const startDate = input.startDate ?? existingProject.startDate.toISOString();
  const endDate = input.endDate !== undefined ? input.endDate : existingProject.endDate?.toISOString() ?? null;
  const projectManagerId = input.projectManagerId ?? existingProject.projectManagerId;

  if (!validateDateRange(startDate, endDate)) {
    return jsonProjectError(
      'INVALID_DATE_RANGE',
      400,
      'La date de fin doit être strictement supérieure à la date de début.',
    );
  }

  const projectManagerIsValid =
    projectManagerId === existingProject.projectManagerId ||
    (await validateProjectManager(prisma, projectManagerId, user));

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
        name: input.name ?? existingProject.name,
        description: input.description ?? existingProject.description,
        address: input.address ?? existingProject.address,
        city: input.city ?? existingProject.city,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        projectManagerId,
        status: input.status ?? existingProject.status,
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
