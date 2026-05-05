import { NextResponse } from 'next/server';
import { Prisma, ProjectStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAuth } from '@/lib/auth/with-auth';
import { listProjectsPage, parseProjectListQuery } from '@/lib/project-web';
import {
  canReadProjects,
  canWriteProjects,
  jsonProjectError,
  parseCreateProjectInput,
  parseJsonBody,
  projectPublicSelect,
  serializeProject,
  validateDateRange,
  validateProjectManager,
} from '@/lib/projects';

export const GET = withAuth(async ({ req, user }) => {
  if (!canReadProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Acces refuse aux projets.');
  }

  const query = parseProjectListQuery(req.nextUrl.searchParams);
  if (!query) {
    return jsonProjectError('BAD_REQUEST', 400, 'Les filtres projets sont invalides.');
  }

  return NextResponse.json(await listProjectsPage(prisma, user, query));
});

export const POST = withAuth(async ({ req, user }) => {
  if (!canWriteProjects(user.role)) {
    return jsonProjectError('FORBIDDEN', 403, 'Acces refuse a la creation de projet.');
  }

  const body = await parseJsonBody<unknown>(req);
  const input = parseCreateProjectInput(body);

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
    const project = await prisma.project.create({
      data: {
        name: input.name,
        description: input.description,
        address: input.address,
        city: input.city,
        startDate: new Date(input.startDate),
        endDate: input.endDate ? new Date(input.endDate) : null,
        projectManagerId: input.projectManagerId,
        status: input.status ?? ProjectStatus.IN_PROGRESS,
        createdById: user.id,
      },
      select: projectPublicSelect,
    });

    return NextResponse.json({ project: serializeProject(project) }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return jsonProjectError('INVALID_PROJECT_MANAGER', 400, 'Chef de projet invalide.');
    }

    throw error;
  }
});
