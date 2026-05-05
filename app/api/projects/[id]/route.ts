import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { getProjectDetailForWeb } from '@/lib/project-web';
import {
  archiveProject,
  canReadProjects,
  canWriteProjects,
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
  if (!canReadProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Acces refuse aux projets.');
  }

  const project = await getProjectDetailForWeb(prisma, params.id, user);

  if (!project) {
    return jsonProjectError('NOT_FOUND', 404, 'Projet introuvable.');
  }

  return NextResponse.json({ project });
});

export const PUT = withAuth<{ id: string }>(async ({ params, req, user }) => {
  if (!canWriteProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Acces refuse a la modification de projet.');
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
      'La date de fin doit etre strictement superieure a la date de debut.',
    );
  }

  const projectManagerIsValid = await validateProjectManager(prisma, input.projectManagerId, user);

  if (!projectManagerIsValid) {
    return jsonProjectError(
      'INVALID_PROJECT_MANAGER',
      400,
      'Le chef de projet selectionne est invalide pour cette operation.',
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

    return NextResponse.json({ project: serializeProjectDetail(project) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return jsonProjectError('INVALID_PROJECT_MANAGER', 400, 'Chef de projet invalide.');
    }

    throw error;
  }
});

export const DELETE = withAuth<{ id: string }>(async ({ params, user }) => {
  if (!canWriteProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, "Acces refuse a l'archivage de projet.");
  }

  const existingProject = await getScopedProjectById(prisma, params.id, user);

  if (!existingProject) {
    return jsonProjectError('NOT_FOUND', 404, 'Projet introuvable.');
  }

  const archived = await archiveProject(prisma, params.id);

  if (archived.error) {
    return archived.error;
  }

  return NextResponse.json({
    project: serializeProjectDetail(archived.project),
  });
});
